using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Caching;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Models;
using WealthWatcher.Api.Services;

namespace WealthWatcher.Api.Extensions;

public static class AssetEndpointExtensions
{
    private static readonly Guid AssetKindGroupId =
        new("9b4a7e1c-4d4d-4c4f-a6e9-9ca2f2f92c11");

    public static WebApplication MapAssetEndpoints(this WebApplication app)
    {
        app.MapGet("/api/classification-groups", async (WealthDbContext db) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            var kinds = await LoadKindsAsync(db);
            var groups = await db.AssetGroups
                .AsNoTracking()
                .Where(group => group.ArchivedAt == null)
                .OrderBy(group => group.DisplayOrder)
                .ToListAsync();

            return Results.Ok(new[]
            {
                new ClassificationGroupResponse
                {
                    Id = AssetKindGroupId,
                    Key = AssetClassificationKeys.Assets,
                    DisplayName = "Asset",
                    DisplayOrder = 0,
                    Values = kinds.Select(ToClassificationValueResponse).ToList()
                },
                new ClassificationGroupResponse
                {
                    Id = AssetClassificationKeys.AssetClasses == AssetClassificationKeys.Assets
                        ? AssetKindGroupId
                        : groups.FirstOrDefault()?.Id ?? Guid.Empty,
                    Key = AssetClassificationKeys.AssetClasses,
                    DisplayName = "Asset class",
                    DisplayOrder = 1,
                    Values = groups.Select(ToClassificationValueResponse).ToList()
                }
            });
        });

        app.MapGet("/api/asset-kinds", async (WealthDbContext db) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            return Results.Ok((await LoadKindsAsync(db)).Select(ToAssetKindResponse));
        });

        app.MapGet("/api/asset-groups", async (WealthDbContext db) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            var groups = await db.AssetGroups
                .AsNoTracking()
                .Where(group => group.ArchivedAt == null)
                .OrderBy(group => group.DisplayOrder)
                .ToListAsync();
            return Results.Ok(groups.Select(ToAssetGroupResponse));
        });

        app.MapPost("/api/classification-groups/{groupKey}/values", async (
            string groupKey,
            ClassificationValueCreateDto dto,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            var normalizedGroupKey = NormalizeGroupKey(groupKey);
            if (normalizedGroupKey is not AssetClassificationKeys.Assets and not AssetClassificationKeys.AssetClasses)
                return Results.BadRequest(new { Error = "Only Asset class and Asset values are supported." });

            var displayName = dto.DisplayName?.Trim() ?? string.Empty;
            var key = string.IsNullOrWhiteSpace(dto.Key)
                ? GenerateKey(displayName)
                : Slugify(dto.Key, displayName);
            if (string.IsNullOrWhiteSpace(displayName) || string.IsNullOrWhiteSpace(key))
                return Results.BadRequest(new { Error = "A classification value name is required." });

            if (normalizedGroupKey == AssetClassificationKeys.Assets)
            {
                var active = await db.AssetKinds.FirstOrDefaultAsync(kind =>
                    kind.ArchivedAt == null && kind.Code.ToLower() == key.ToLower());
                if (active is not null)
                    return Results.Conflict(new { Error = "A classification value with this key already exists." });

                var kind = await db.AssetKinds.FirstOrDefaultAsync(candidate =>
                    candidate.ArchivedAt != null && candidate.Code.ToLower() == key.ToLower());
                if (kind is null)
                {
                    kind = new AssetKind
                    {
                        Code = key,
                        DisplayName = displayName,
                        Color = NormalizeColor(dto.Color),
                        DisplayOrder = dto.DisplayOrder,
                        ValueShape = InferValueShape(key)
                    };
                    db.AssetKinds.Add(kind);
                }
                else
                {
                    kind.DisplayName = displayName;
                    kind.Color = NormalizeColor(dto.Color);
                    kind.DisplayOrder = dto.DisplayOrder;
                    kind.ArchivedAt = null;
                }

                try
                {
                    await SetKindGroupAsync(db, kind, dto.ParentValueId);
                }
                catch (ArgumentException exception)
                {
                    return Results.BadRequest(new { Error = exception.Message });
                }

                await db.SaveChangesAsync();
                await invalidator.InvalidateCatalogueAsync(cancellationToken);
                await invalidator.InvalidateWealthAsync(cancellationToken);
                return Results.Ok(await LoadClassificationValueAsync(db, kind.Id));
            }

            var activeGroup = await db.AssetGroups.FirstOrDefaultAsync(group =>
                group.ArchivedAt == null && group.Code.ToLower() == key.ToLower());
            if (activeGroup is not null)
                return Results.Conflict(new { Error = "A classification value with this key already exists." });

            var archivedGroup = await db.AssetGroups.FirstOrDefaultAsync(group =>
                group.ArchivedAt != null && group.Code.ToLower() == key.ToLower());
            if (archivedGroup is null)
            {
                archivedGroup = new AssetGroup
                {
                    Code = key,
                    DisplayName = displayName,
                    Color = NormalizeColor(dto.Color),
                    DisplayOrder = dto.DisplayOrder,
                    IsSystem = false
                };
                db.AssetGroups.Add(archivedGroup);
            }
            else
            {
                archivedGroup.DisplayName = displayName;
                archivedGroup.Color = NormalizeColor(dto.Color);
                archivedGroup.DisplayOrder = dto.DisplayOrder;
                archivedGroup.ArchivedAt = null;
            }

            await db.SaveChangesAsync();
            await invalidator.InvalidateCatalogueAsync(cancellationToken);
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.Ok(await LoadClassificationValueAsync(db, archivedGroup.Id));
        });

        app.MapPatch("/api/classification-values/{id:guid}", async (
            Guid id,
            ClassificationValueUpdateDto dto,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            var kind = await db.AssetKinds.FirstOrDefaultAsync(candidate => candidate.Id == id);
            if (kind is not null)
            {
                if (AssetCatalogService.IsUnclassified(kind) &&
                    dto.ParentValueId.HasValue)
                    return Results.BadRequest(new { Error = "Unclassified cannot be assigned to an AssetGroup." });

                if (AssetCatalogService.IsUnclassified(kind) && dto.Archived == true)
                    return Results.BadRequest(new { Error = "Unclassified is a built-in fallback AssetKind and cannot be archived." });

                if (dto.DisplayName is not null)
                {
                    var displayName = dto.DisplayName.Trim();
                    if (string.IsNullOrWhiteSpace(displayName))
                        return Results.BadRequest(new { Error = "A classification value name is required." });
                    kind.DisplayName = displayName;
                }
                if (dto.Color is not null)
                    kind.Color = dto.Color.Trim();
                if (dto.DisplayOrder.HasValue)
                    kind.DisplayOrder = dto.DisplayOrder.Value;

                if (dto.ParentValueId.HasValue || dto.ClearParentValue == true)
                {
                    try
                    {
                        await SetKindGroupAsync(db, kind, dto.ClearParentValue == true ? null : dto.ParentValueId);
                    }
                    catch (ArgumentException exception)
                    {
                        return Results.BadRequest(new { Error = exception.Message });
                    }
                }

                if (dto.Archived == true)
                {
                    try
                    {
                        await AssetCatalogService.ArchiveAssetKindAsync(db, kind);
                    }
                    catch (ArgumentException exception)
                    {
                        return Results.BadRequest(new { Error = exception.Message });
                    }
                }
                else if (dto.Archived == false)
                {
                    kind.ArchivedAt = null;
                }

                await db.SaveChangesAsync();
                await invalidator.InvalidateCatalogueAsync(cancellationToken);
                await invalidator.InvalidateWealthAsync(cancellationToken);
                return Results.Ok(await LoadClassificationValueAsync(db, kind.Id));
            }

            var group = await db.AssetGroups.FirstOrDefaultAsync(candidate => candidate.Id == id);
            if (group is null)
                return Results.NotFound(new { Error = "Classification value not found." });

            if (dto.DisplayName is not null)
            {
                var displayName = dto.DisplayName.Trim();
                if (string.IsNullOrWhiteSpace(displayName))
                    return Results.BadRequest(new { Error = "A classification value name is required." });
                group.DisplayName = displayName;
            }
            if (dto.Color is not null)
                group.Color = dto.Color.Trim();
            if (dto.DisplayOrder.HasValue)
                group.DisplayOrder = dto.DisplayOrder.Value;
            if (dto.ParentValueId.HasValue || dto.ClearParentValue == true)
                return Results.BadRequest(new { Error = "Asset groups cannot have a parent value." });
            if (dto.Archived.HasValue)
                group.ArchivedAt = dto.Archived.Value ? group.ArchivedAt ?? DateTimeOffset.UtcNow : null;

            await db.SaveChangesAsync();
            await invalidator.InvalidateCatalogueAsync(cancellationToken);
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.Ok(await LoadClassificationValueAsync(db, group.Id));
        });

        app.MapDelete("/api/classification-values/{id:guid}", async (
            Guid id,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            var kind = await db.AssetKinds.FirstOrDefaultAsync(candidate => candidate.Id == id);
            if (kind is not null)
            {
                AssetKindArchiveResult archiveResult;
                try
                {
                    archiveResult = await AssetCatalogService.ArchiveAssetKindAsync(db, kind);
                }
                catch (ArgumentException exception)
                {
                    return Results.BadRequest(new { Error = exception.Message });
                }

                await db.SaveChangesAsync();
                await invalidator.InvalidateCatalogueAsync(cancellationToken);
                await invalidator.InvalidateWealthAsync(cancellationToken);
                return Results.Ok(archiveResult);
            }

            var group = await db.AssetGroups.FirstOrDefaultAsync(candidate => candidate.Id == id);
            if (group is null)
                return Results.NotFound(new { Error = "Classification value not found." });

            var groupedAssets = await db.Assets
                .Where(asset => asset.AssetGroupId == group.Id)
                .ToListAsync();
            foreach (var asset in groupedAssets)
            {
                asset.AssetGroupId = null;
                asset.AssetGroupAssignmentSet = true;
            }

            group.ArchivedAt ??= DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await invalidator.InvalidateCatalogueAsync(cancellationToken);
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.NoContent();
        });

        app.MapGet("/api/assets", async (
            bool? includeArchived,
            Guid? classificationValueId,
            WealthDbContext db) =>
        {
            var query = db.Assets
                .AsNoTracking()
                .Include(asset => asset.AssetGroup)
                .Include(asset => asset.AssetKindAssignments)
                    .ThenInclude(assignment => assignment.AssetKind)
                        .ThenInclude(kind => kind!.GroupMappings)
                            .ThenInclude(mapping => mapping.AssetGroup)
                .AsQueryable();

            if (includeArchived != true)
                query = query.Where(asset => asset.ArchivedAt == null);
            if (classificationValueId.HasValue)
            {
                query = query.Where(asset =>
                    (asset.AssetGroupAssignmentSet && asset.AssetGroupId == classificationValueId.Value) ||
                    asset.AssetKindAssignments.Any(assignment => assignment.AssetKindId == classificationValueId.Value) ||
                    (!asset.AssetGroupAssignmentSet && asset.AssetKindAssignments.Any(assignment => assignment.AssetKind != null &&
                        assignment.AssetKind.GroupMappings.Any(mapping => mapping.AssetGroupId == classificationValueId.Value))));
            }

            var assets = await query.OrderBy(asset => asset.DisplayName).ToListAsync();
            return Results.Ok(assets.Select(ToAssetResponse));
        });

        app.MapGet("/api/assets/{id:guid}", async (Guid id, WealthDbContext db) =>
        {
            var asset = await LoadAssetAsync(db, id, tracking: false);
            return asset is null
                ? Results.NotFound(new { Error = "Asset not found." })
                : Results.Ok(ToAssetResponse(asset));
        });

        app.MapPost("/api/assets", async (
            AssetCreateDto dto,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            var displayName = dto.DisplayName?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(displayName))
                return Results.BadRequest(new { Error = "An asset display name is required." });

            AssetCatalogService.EnsureDefaults(db);
            Guid? kindId;
            try
            {
                kindId = await ResolveKindIdAsync(db, dto.AssetKindId, dto.AssetKindIds ?? dto.ClassificationValueIds,
                    dto.EntryKind);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }

            if (!kindId.HasValue)
                return Results.BadRequest(new { Error = "An asset kind is required." });

            Guid? groupId;
            var groupAssignmentSet = dto.SetAssetGroup == true;
            try
            {
                groupId = groupAssignmentSet
                    ? dto.AssetGroupId.HasValue
                        ? await ResolveAssetGroupIdAsync(db, dto.AssetGroupId, null)
                        : null
                    : await ResolveAssetGroupIdAsync(db, dto.AssetGroupId, kindId.Value);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }

            var asset = new Asset
            {
                DisplayName = displayName,
                AssetGroupId = groupId,
                AssetGroupAssignmentSet = groupAssignmentSet || groupId.HasValue
            };
            db.Assets.Add(asset);
            var template = new CashAssetValueEntry
            {
                AssetId = asset.Id,
                Name = displayName,
                AssetKindCode = string.Empty,
                Date = DateOnly.FromDateTime(DateTime.UtcNow),
                Time = TimeOnly.MinValue,
                Value = 0m
            };

            try
            {
                await AssetCatalogService.EnsureAssetForEntryAsync(
                    db,
                    template,
                    displayName,
                    [kindId.Value],
                    requireExplicitAsset: true);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }

            await db.SaveChangesAsync();
            await invalidator.InvalidateCatalogueAsync(cancellationToken);
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.Ok(await LoadAssetResponseAsync(db, asset.Id));
        });

        app.MapPatch("/api/assets/{id:guid}", async (
            Guid id,
            AssetUpdateDto dto,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            AssetCatalogService.EnsureDefaults(db);
            var asset = await db.Assets.FirstOrDefaultAsync(candidate => candidate.Id == id);
            if (asset is null)
                return Results.NotFound(new { Error = "Asset not found." });

            Guid? resolvedKindId = null;

            if (dto.DisplayName is not null)
            {
                var displayName = dto.DisplayName.Trim();
                if (string.IsNullOrWhiteSpace(displayName))
                    return Results.BadRequest(new { Error = "An asset display name is required." });
                asset.DisplayName = displayName;
            }

            if (dto.AssetKindId.HasValue || dto.AssetKindIds is not null || dto.ClassificationValueIds is not null || dto.EntryKind is not null)
            {
                try
                {
                    resolvedKindId = await ResolveKindIdAsync(
                        db,
                        dto.AssetKindId,
                        dto.AssetKindIds ?? dto.ClassificationValueIds,
                        dto.EntryKind);
                    if (!resolvedKindId.HasValue)
                        return Results.BadRequest(new { Error = "An asset kind is required." });
                    await AssignKindAsync(db, asset.Id, resolvedKindId.Value);
                }
                catch (ArgumentException exception)
                {
                    return Results.BadRequest(new { Error = exception.Message });
                }
            }

            if (dto.SetAssetGroup == true)
            {
                try
                {
                    asset.AssetGroupId = dto.AssetGroupId.HasValue
                        ? await ResolveAssetGroupIdAsync(db, dto.AssetGroupId, null)
                        : null;
                    asset.AssetGroupAssignmentSet = true;
                }
                catch (ArgumentException exception)
                {
                    return Results.BadRequest(new { Error = exception.Message });
                }
            }

            if (dto.Archived.HasValue)
                asset.ArchivedAt = dto.Archived.Value ? asset.ArchivedAt ?? DateTimeOffset.UtcNow : null;

            await db.SaveChangesAsync();
            await invalidator.InvalidateCatalogueAsync(cancellationToken);
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.Ok(await LoadAssetResponseAsync(db, asset.Id));
        });

        app.MapGet("/api/external-values", async (WealthDbContext db) =>
        {
            var values = await db.ExternalValues
                .AsNoTracking()
                .Include(value => value.IntegrationAccount)
                    .ThenInclude(account => account!.IntegrationConnection)
                        .ThenInclude(connection => connection!.IntegrationProvider)
                .Include(value => value.AssetMappings)
                    .ThenInclude(mapping => mapping.Asset)
                .OrderBy(value => value.DisplayName)
                .ToListAsync();
            return Results.Ok(values.Select(ToExternalValueResponse));
        });

        // Compatibility route. The persisted relationship is now
        // ExternalValueAssetMappings, scoped by IntegrationAccountId.
        app.MapGet("/api/provider-links", async (WealthDbContext db) =>
        {
            var values = await db.ExternalValues
                .AsNoTracking()
                .Include(value => value.IntegrationAccount)
                    .ThenInclude(account => account!.IntegrationConnection)
                        .ThenInclude(connection => connection!.IntegrationProvider)
                .Include(value => value.AssetMappings)
                    .ThenInclude(mapping => mapping.Asset)
                .OrderBy(value => value.DisplayName)
                .ToListAsync();
            return Results.Ok(values.Select(ToProviderAssetLinkResponse));
        });

        app.MapPost("/api/external-values", async (
            ExternalValueCreateDto dto,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            var account = await db.IntegrationAccounts.FindAsync(dto.IntegrationAccountId);
            if (account is null)
                return Results.NotFound(new { Error = "Integration account not found." });
            var asset = await db.Assets.FindAsync(dto.AssetId);
            if (asset is null)
                return Results.NotFound(new { Error = "Asset not found." });
            if (asset.ArchivedAt.HasValue)
                return Results.BadRequest(new { Error = "Archived assets cannot receive external value mappings." });
            if (string.IsNullOrWhiteSpace(dto.ExternalId))
                return Results.BadRequest(new { Error = "An external value ID is required." });

            var value = await AssetCatalogService.UpsertExternalValueAsync(
                db,
                account,
                dto.ExternalId.Trim(),
                string.IsNullOrWhiteSpace(dto.DisplayName) ? asset.DisplayName : dto.DisplayName.Trim(),
                dto.Role,
                asset.Id);
            await db.SaveChangesAsync();
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.Ok(await LoadExternalValueResponseAsync(db, value.Id));
        });

        app.MapPost("/api/provider-links", async (
            ProviderAssetLinkCreateDto dto,
            WealthDbContext db,
            IWealthCacheInvalidator invalidator,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(dto.ProviderKey) || string.IsNullOrWhiteSpace(dto.ExternalAssetId))
                return Results.BadRequest(new { Error = "Provider key and external asset ID are required." });

            var account = await db.IntegrationAccounts
                .Include(candidate => candidate.IntegrationConnection)
                    .ThenInclude(connection => connection!.IntegrationProvider)
                .Where(candidate => candidate.IntegrationConnection!.IntegrationProvider!.Code == dto.ProviderKey.Trim())
                .OrderBy(candidate => candidate.DisplayName)
                .FirstOrDefaultAsync();
            if (account is null)
                return Results.BadRequest(new { Error = "Use /api/external-values with an IntegrationAccountId." });

            var asset = await db.Assets.FindAsync(dto.AssetId);
            if (asset is null)
                return Results.NotFound(new { Error = "Asset not found." });
            if (asset.ArchivedAt.HasValue)
                return Results.BadRequest(new { Error = "Archived assets cannot receive external value mappings." });

            var value = await AssetCatalogService.UpsertExternalValueAsync(
                db,
                account,
                dto.ExternalAssetId.Trim(),
                string.IsNullOrWhiteSpace(dto.ExternalName) ? asset.DisplayName : dto.ExternalName.Trim(),
                ExternalValueRole.Other,
                asset.Id);
            await db.SaveChangesAsync();
            await invalidator.InvalidateWealthAsync(cancellationToken);
            return Results.Ok(ToProviderAssetLinkResponse(await LoadExternalValueAsync(db, value.Id)));
        });

        return app;
    }

    private static async Task<List<AssetKind>> LoadKindsAsync(WealthDbContext db) =>
        await db.AssetKinds
            .AsNoTracking()
            .Include(kind => kind.GroupMappings)
                .ThenInclude(mapping => mapping.AssetGroup)
            .Where(kind => kind.ArchivedAt == null)
            .OrderBy(kind => kind.DisplayOrder)
            .ThenBy(kind => kind.DisplayName)
            .ToListAsync();

    private static async Task<Asset?> LoadAssetAsync(WealthDbContext db, Guid id, bool tracking)
    {
        var query = db.Assets
            .Include(asset => asset.AssetGroup)
            .Include(asset => asset.AssetKindAssignments)
                .ThenInclude(assignment => assignment.AssetKind)
                    .ThenInclude(kind => kind!.GroupMappings)
                        .ThenInclude(mapping => mapping.AssetGroup)
            .AsQueryable();
        if (!tracking)
            query = query.AsNoTracking();
        return await query.FirstOrDefaultAsync(asset => asset.Id == id);
    }

    private static async Task<AssetResponse?> LoadAssetResponseAsync(WealthDbContext db, Guid id)
    {
        var asset = await LoadAssetAsync(db, id, tracking: false);
        return asset is null ? null : ToAssetResponse(asset);
    }

    private static async Task<Guid?> ResolveKindIdAsync(
        WealthDbContext db,
        Guid? explicitKindId,
        IReadOnlyCollection<Guid>? selectedIds,
        string? entryKind)
    {
        if (explicitKindId.HasValue)
            selectedIds = [explicitKindId.Value];

        var ids = selectedIds?.Distinct().ToArray() ?? [];
        if (ids.Length > 1)
            throw new ArgumentException("Only one asset kind may be selected for an asset.");
        if (ids.Length == 1)
        {
            var kind = await db.AssetKinds.FirstOrDefaultAsync(candidate =>
                candidate.Id == ids[0] && candidate.ArchivedAt == null);
            if (kind is not null)
            {
                if (AssetCatalogService.IsUnclassified(kind))
                    throw new ArgumentException(
                        "Unclassified is a system fallback and cannot be selected explicitly.");
                return kind.Id;
            }

            var groupExists = await db.AssetGroups.AnyAsync(candidate =>
                candidate.Id == ids[0] && candidate.ArchivedAt == null);
            throw new ArgumentException(groupExists
                ? "Select an AssetKind; AssetGroups describe kinds and cannot be assigned directly."
                : "One or more asset kinds are invalid.");
        }

        if (string.IsNullOrWhiteSpace(entryKind))
            return null;

        var normalized = AssetCatalogService.NormalizeAssetKindCode(entryKind);
        if (normalized == AssetKindCodes.Unclassified)
            throw new ArgumentException(
                "Unclassified is a system fallback and cannot be selected explicitly.");

        var fallbackCode = normalized switch
        {
            AssetValueShape.Investment => AssetKindCodes.Investments,
            AssetValueShape.Property => AssetKindCodes.Property,
            AssetValueShape.Cash => AssetKindCodes.Cash,
            _ => normalized
        };
        var fallback = await db.AssetKinds.FirstOrDefaultAsync(kind =>
            kind.ArchivedAt == null && kind.Code.ToLower() == fallbackCode.ToLower());
        return fallback?.Id;
    }

    private static async Task<Guid?> ResolveAssetGroupIdAsync(
        WealthDbContext db,
        Guid? explicitGroupId,
        Guid? kindId)
    {
        if (explicitGroupId.HasValue)
        {
            var group = await db.AssetGroups.FirstOrDefaultAsync(candidate =>
                candidate.Id == explicitGroupId.Value && candidate.ArchivedAt == null);
            if (group is null)
                throw new ArgumentException("The selected Asset Group is invalid.", nameof(explicitGroupId));
            return group.Id;
        }

        if (!kindId.HasValue)
            return null;

        var kind = await db.AssetKinds.FirstOrDefaultAsync(candidate => candidate.Id == kindId.Value);
        if (kind is null || AssetCatalogService.IsUnclassified(kind))
            return null;

        return await db.AssetKindGroups
            .Where(mapping => mapping.AssetKindId == kind.Id)
            .Select(mapping => (Guid?)mapping.AssetGroupId)
            .FirstOrDefaultAsync();
    }

    private static async Task AssignKindAsync(WealthDbContext db, Guid assetId, Guid kindId)
    {
        var assignments = await db.AssetKindAssignments
            .Where(assignment => assignment.AssetId == assetId)
            .ToListAsync();
        db.AssetKindAssignments.RemoveRange(assignments);
        db.AssetKindAssignments.Add(new AssetKindAssignment { AssetId = assetId, AssetKindId = kindId });
    }

    private static async Task SetKindGroupAsync(
        WealthDbContext db,
        AssetKind kind,
        Guid? groupId)
    {
        var mappings = await db.AssetKindGroups
            .Where(mapping => mapping.AssetKindId == kind.Id)
            .ToListAsync();
        db.AssetKindGroups.RemoveRange(mappings);

        if (!groupId.HasValue)
            return;

        var group = await db.AssetGroups.FirstOrDefaultAsync(candidate =>
            candidate.Id == groupId.Value && candidate.ArchivedAt == null);
        if (group is null)
            throw new ArgumentException("The parent value must be an active AssetGroup.");

        db.AssetKindGroups.Add(new AssetKindGroup
        {
            AssetKindId = kind.Id,
            AssetGroupId = group.Id,
            AssetKind = kind,
            AssetGroup = group
        });
    }

    private static AssetResponse ToAssetResponse(Asset asset)
    {
        var assignment = asset.AssetKindAssignments.FirstOrDefault();
        var kind = assignment?.AssetKind;
        var group = asset.AssetGroupAssignmentSet
            ? asset.AssetGroup?.ArchivedAt == null ? asset.AssetGroup : null
            : kind?.GroupMappings.FirstOrDefault(mapping => mapping.AssetGroup?.ArchivedAt == null)?.AssetGroup;
        return new AssetResponse
        {
            Id = asset.Id,
            DisplayName = asset.DisplayName,
            Name = asset.DisplayName,
            AssetGroupId = group?.Id,
            AssetGroupAssignmentSet = asset.AssetGroupAssignmentSet,
            CreatedAt = asset.CreatedAt,
            ArchivedAt = asset.ArchivedAt,
            EntryKind = kind?.ValueShape ?? AssetValueShape.Cash,
            AssetKindCode = kind?.Code ?? AssetKindCodes.Unclassified,
            AssetKindId = kind?.Id,
            AssetGroupCode = group?.Code,
            Classifications = kind is null
                ? []
                : new[] { ToClassificationValueResponse(kind) }
                    .Concat(group is null ? [] : [ToClassificationValueResponse(group)])
                    .ToList()
        };
    }

    private static ClassificationValueResponse ToClassificationValueResponse(AssetKind kind)
    {
        var group = kind.GroupMappings.FirstOrDefault(mapping => mapping.AssetGroup?.ArchivedAt == null)?.AssetGroup;
        return new ClassificationValueResponse
        {
            Id = kind.Id,
            GroupId = AssetKindGroupId,
            GroupKey = AssetClassificationKeys.Assets,
            GroupName = "Asset",
            Key = kind.Code,
            DisplayName = kind.DisplayName,
            Color = kind.Color,
            DisplayOrder = kind.DisplayOrder,
            ParentValueId = group?.Id
        };
    }

    private static ClassificationValueResponse ToClassificationValueResponse(AssetGroup group) =>
        new()
        {
            Id = group.Id,
            GroupId = group.Id,
            GroupKey = AssetClassificationKeys.AssetClasses,
            GroupName = "Asset class",
            Key = group.Code,
            DisplayName = group.DisplayName,
            Color = group.Color,
            DisplayOrder = group.DisplayOrder
        };

    private static AssetKindResponse ToAssetKindResponse(AssetKind kind) =>
        new()
        {
            Id = kind.Id,
            Code = kind.Code,
            DisplayName = kind.DisplayName,
            Color = kind.Color,
            DisplayOrder = kind.DisplayOrder,
            ValueShape = kind.ValueShape,
            AssetGroupId = kind.GroupMappings.FirstOrDefault(mapping => mapping.AssetGroup?.ArchivedAt == null)?.AssetGroupId,
            AssetGroupCode = kind.GroupMappings.FirstOrDefault(mapping => mapping.AssetGroup?.ArchivedAt == null)?.AssetGroup?.Code
        };

    private static AssetGroupResponse ToAssetGroupResponse(AssetGroup group) =>
        new()
        {
            Id = group.Id,
            Code = group.Code,
            DisplayName = group.DisplayName,
            Color = group.Color,
            DisplayOrder = group.DisplayOrder,
            IsSystem = group.IsSystem
        };

    private static async Task<ClassificationValueResponse> LoadClassificationValueAsync(
        WealthDbContext db,
        Guid id)
    {
        var kind = await db.AssetKinds
            .Include(candidate => candidate.GroupMappings)
                .ThenInclude(mapping => mapping.AssetGroup)
            .FirstOrDefaultAsync(candidate => candidate.Id == id);
        if (kind is not null)
            return ToClassificationValueResponse(kind);

        var group = await db.AssetGroups.FirstAsync(candidate => candidate.Id == id);
        return ToClassificationValueResponse(group);
    }

    private static async Task<ExternalValue?> LoadExternalValueAsync(WealthDbContext db, Guid id) =>
        await db.ExternalValues
            .AsNoTracking()
            .Include(value => value.IntegrationAccount)
                .ThenInclude(account => account!.IntegrationConnection)
                    .ThenInclude(connection => connection!.IntegrationProvider)
            .Include(value => value.AssetMappings)
                .ThenInclude(mapping => mapping.Asset)
            .FirstOrDefaultAsync(value => value.Id == id);

    private static async Task<ExternalValueResponse?> LoadExternalValueResponseAsync(WealthDbContext db, Guid id)
    {
        var value = await LoadExternalValueAsync(db, id);
        return value is null ? null : ToExternalValueResponse(value);
    }

    private static ExternalValueResponse ToExternalValueResponse(ExternalValue value)
    {
        var mapping = value.AssetMappings.FirstOrDefault();
        return new ExternalValueResponse
        {
            Id = value.Id,
            IntegrationAccountId = value.IntegrationAccountId,
            IntegrationConnectionId = value.IntegrationAccount?.IntegrationConnectionId,
            ProviderKey = value.IntegrationAccount?.IntegrationConnection?.IntegrationProvider?.Code ?? string.Empty,
            ExternalId = value.ExternalId,
            DisplayName = value.DisplayName,
            Role = value.Role,
            AssetId = mapping?.AssetId,
            AssetDisplayName = mapping?.Asset?.DisplayName ?? string.Empty,
            CreatedAt = value.CreatedAt,
            LastSeenAt = value.LastSeenAt
        };
    }

    private static ProviderAssetLinkResponse ToProviderAssetLinkResponse(ExternalValue value)
    {
        var response = ToExternalValueResponse(value);
        return new ProviderAssetLinkResponse
        {
            Id = response.Id,
            IntegrationConnectionId = response.IntegrationConnectionId,
            ProviderKey = response.ProviderKey,
            ExternalAssetId = response.ExternalId,
            AssetId = response.AssetId ?? Guid.Empty,
            AssetDisplayName = response.AssetDisplayName,
            ExternalName = response.DisplayName,
            CreatedAt = response.CreatedAt,
            LastSeenAt = response.LastSeenAt
        };
    }

    private static string NormalizeGroupKey(string? key) =>
        key?.Trim().ToLowerInvariant() switch
        {
            "asset-class" or "asset-classes" or "assets" or "asset-kind" or "asset-kinds" =>
                AssetClassificationKeys.Assets,
            "liquidity" or "asset-group" or "asset-groups" or "asset-class-group" =>
                AssetClassificationKeys.AssetClasses,
            _ => key?.Trim().ToLowerInvariant() ?? string.Empty
        };

    private static string InferValueShape(string code) => code.ToLowerInvariant() switch
    {
        "property" or "properties" => AssetValueShape.Property,
        "investment" or "investments" or "pension" or "pensions" => AssetValueShape.Investment,
        _ => AssetValueShape.Cash
    };

    private static string NormalizeColor(string? color) =>
        string.IsNullOrWhiteSpace(color) ? "#64748b" : color.Trim();

    private static string Slugify(string? rawKey, string fallback)
    {
        var source = string.IsNullOrWhiteSpace(rawKey) ? fallback : rawKey;
        var chars = source.Trim().ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) ? character : '-')
            .ToArray();
        return string.Join('-', new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
    }

    private static string GenerateKey(string displayName)
    {
        var words = displayName.Trim().ToLowerInvariant()
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        return string.Join('_', words);
    }
}

public sealed class ClassificationGroupResponse
{
    public Guid Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public List<ClassificationValueResponse> Values { get; set; } = new();
}

public sealed class ClassificationValueResponse
{
    public Guid Id { get; set; }
    public Guid GroupId { get; set; }
    public string GroupKey { get; set; } = string.Empty;
    public string GroupName { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public Guid? ParentValueId { get; set; }
}

public sealed class AssetKindResponse
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public string ValueShape { get; set; } = string.Empty;
    public Guid? AssetGroupId { get; set; }
    public string? AssetGroupCode { get; set; }
}

public sealed class AssetGroupResponse
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public bool IsSystem { get; set; }
}

public sealed class AssetResponse
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string EntryKind { get; set; } = string.Empty;
    public string AssetKindCode { get; set; } = string.Empty;
    public Guid? AssetKindId { get; set; }
    public Guid? AssetGroupId { get; set; }
    public bool AssetGroupAssignmentSet { get; set; }
    public string? AssetGroupCode { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public List<ClassificationValueResponse> Classifications { get; set; } = new();
}

public sealed class ClassificationValueCreateDto
{
    public string? Key { get; set; }
    public string? DisplayName { get; set; }
    public string? Color { get; set; }
    public int DisplayOrder { get; set; }
    public Guid? ParentValueId { get; set; }
}

public sealed class ClassificationValueUpdateDto
{
    public string? DisplayName { get; set; }
    public string? Color { get; set; }
    public int? DisplayOrder { get; set; }
    public Guid? ParentValueId { get; set; }
    public bool? ClearParentValue { get; set; }
    public bool? Archived { get; set; }
}

public sealed class AssetCreateDto
{
    public string? DisplayName { get; set; }
    public string? EntryKind { get; set; }
    public Guid? AssetKindId { get; set; }
    public Guid? AssetGroupId { get; set; }
    public bool? SetAssetGroup { get; set; }
    public IReadOnlyCollection<Guid>? AssetKindIds { get; set; }
    public IReadOnlyCollection<Guid>? ClassificationValueIds { get; set; }
}

public sealed class AssetUpdateDto
{
    public string? DisplayName { get; set; }
    public string? EntryKind { get; set; }
    public Guid? AssetKindId { get; set; }
    public Guid? AssetGroupId { get; set; }
    public bool? SetAssetGroup { get; set; }
    public IReadOnlyCollection<Guid>? AssetKindIds { get; set; }
    public IReadOnlyCollection<Guid>? ClassificationValueIds { get; set; }
    public bool? Archived { get; set; }
}

public sealed class ExternalValueCreateDto
{
    public Guid IntegrationAccountId { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public ExternalValueRole Role { get; set; } = ExternalValueRole.Other;
    public Guid AssetId { get; set; }
}

public sealed class ExternalValueResponse
{
    public Guid Id { get; set; }
    public Guid IntegrationAccountId { get; set; }
    public Guid? IntegrationConnectionId { get; set; }
    public string ProviderKey { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public ExternalValueRole Role { get; set; }
    public Guid? AssetId { get; set; }
    public string AssetDisplayName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastSeenAt { get; set; }
}

public sealed class ProviderAssetLinkCreateDto
{
    public string ProviderKey { get; set; } = string.Empty;
    public string ExternalAssetId { get; set; } = string.Empty;
    public Guid AssetId { get; set; }
    public string? ExternalName { get; set; }
}

public sealed class ProviderAssetLinkResponse
{
    public Guid Id { get; set; }
    public Guid? IntegrationConnectionId { get; set; }
    public string ProviderKey { get; set; } = string.Empty;
    public string ExternalAssetId { get; set; } = string.Empty;
    public Guid AssetId { get; set; }
    public string AssetDisplayName { get; set; } = string.Empty;
    public string ExternalName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastSeenAt { get; set; }
}
