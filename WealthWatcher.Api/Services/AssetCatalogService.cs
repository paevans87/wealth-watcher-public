using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Services;

public static class AssetCatalogService
{
    private static readonly IReadOnlyDictionary<string, (string Label, string Color, int Order, string Shape, string? Group)> DefaultKinds =
        new Dictionary<string, (string, string, int, string, string?)>(StringComparer.OrdinalIgnoreCase)
        {
            [AssetKindCodes.Cash] = ("Cash", "#06b6d4", 1, AssetValueShape.Cash, AssetGroupCodes.Liquid),
            [AssetKindCodes.Savings] = ("Savings", "#3b82f6", 2, AssetValueShape.Cash, AssetGroupCodes.Liquid),
            [AssetKindCodes.Investments] = ("Investments", "#10b981", 3, AssetValueShape.Investment, AssetGroupCodes.Liquid),
            [AssetKindCodes.Property] = ("Property", "#f59e0b", 4, AssetValueShape.Property, AssetGroupCodes.Illiquid),
            [AssetKindCodes.Pensions] = ("Pensions", "#8b5cf6", 5, AssetValueShape.Investment, AssetGroupCodes.Illiquid),
            [AssetKindCodes.Bonds] = ("Bonds", "#ec4899", 6, AssetValueShape.Cash, AssetGroupCodes.Liquid),
            [AssetKindCodes.Unclassified] = ("Unclassified", "#64748b", 99, AssetValueShape.Cash, null)
        };

    public static void EnsureDefaults(WealthDbContext db)
    {
        var changed = false;
        var groups = db.AssetGroups.ToList();
        var kinds = db.AssetKinds.ToList();

        foreach (var (code, metadata) in new[]
                 {
                     (AssetGroupCodes.Liquid, ("Liquid", "#10b981", 1)),
                     (AssetGroupCodes.Illiquid, ("Illiquid", "#f59e0b", 2))
                 })
        {
            var group = groups.FirstOrDefault(candidate =>
                candidate.Code.Equals(code, StringComparison.OrdinalIgnoreCase));
            if (group is null)
            {
                group = new AssetGroup
                {
                    Code = code,
                    DisplayName = metadata.Item1,
                    Color = metadata.Item2,
                    DisplayOrder = metadata.Item3,
                    IsSystem = true
                };
                db.AssetGroups.Add(group);
                groups.Add(group);
                changed = true;
            }
            else
            {
                if (group.ArchivedAt.HasValue)
                {
                    group.ArchivedAt = null;
                    changed = true;
                }

                if (!group.IsSystem)
                {
                    group.IsSystem = true;
                    changed = true;
                }
            }
        }

        foreach (var (code, metadata) in DefaultKinds)
        {
            var kind = kinds.FirstOrDefault(candidate =>
                candidate.Code.Equals(code, StringComparison.OrdinalIgnoreCase));
            if (kind is null)
            {
                kind = new AssetKind
                {
                    Code = code,
                    DisplayName = metadata.Label,
                    Color = metadata.Color,
                    DisplayOrder = metadata.Order,
                    ValueShape = metadata.Shape
                };
                db.AssetKinds.Add(kind);
                kinds.Add(kind);
                changed = true;
            }
            else
            {
                if (kind.ArchivedAt.HasValue)
                {
                    kind.ArchivedAt = null;
                    changed = true;
                }

                if (kind.ValueShape != metadata.Shape)
                {
                    kind.ValueShape = metadata.Shape;
                    changed = true;
                }
            }

            if (metadata.Group is not null)
            {
                var group = groups.First(candidate =>
                    candidate.Code.Equals(metadata.Group, StringComparison.OrdinalIgnoreCase));
                var mapping = db.AssetKindGroups.Local.FirstOrDefault(candidate =>
                    candidate.AssetKindId == kind.Id) ??
                    db.AssetKindGroups.FirstOrDefault(candidate => candidate.AssetKindId == kind.Id);
                if (mapping is null)
                {
                    db.AssetKindGroups.Add(new AssetKindGroup
                    {
                        AssetKindId = kind.Id,
                        AssetGroupId = group.Id,
                        AssetKind = kind,
                        AssetGroup = group
                    });
                    changed = true;
                }
                else if (mapping.AssetGroupId != group.Id)
                {
                    mapping.AssetGroupId = group.Id;
                    changed = true;
                }
            }
        }

        // Unclassified is the system fallback. Older versions could persist a
        // stale AssetKindGroup row for it, so remove every such row whenever
        // the catalogue is repaired.
        var unclassified = kinds.First(kind =>
            kind.Code.Equals(AssetKindCodes.Unclassified, StringComparison.OrdinalIgnoreCase));
        var staleUnclassifiedMappings = db.AssetKindGroups
            .Where(mapping => mapping.AssetKindId == unclassified.Id)
            .ToList();
        if (staleUnclassifiedMappings.Count > 0)
        {
            db.AssetKindGroups.RemoveRange(staleUnclassifiedMappings);
            changed = true;
        }

        if (changed)
            db.SaveChanges();
    }

    public static async Task<AssetKindArchiveResult> ArchiveAssetKindAsync(
        WealthDbContext db,
        AssetKind kind)
    {
        EnsureDefaults(db);

        if (IsUnclassified(kind))
            throw new ArgumentException("Unclassified is a built-in fallback AssetKind and cannot be archived.", nameof(kind));

        var unclassified = await FindAssetKindAsync(db, AssetKindCodes.Unclassified);
        if (unclassified is null)
            throw new InvalidOperationException("The built-in Unclassified AssetKind is unavailable.");

        var assignments = await db.AssetKindAssignments
            .Where(assignment => assignment.AssetKindId == kind.Id)
            .ToListAsync();
        var assetIds = assignments
            .Select(assignment => assignment.AssetId)
            .ToHashSet();
        var existingFallbackAssignments = assetIds.Count == 0
            ? new HashSet<Guid>()
            : (await db.AssetKindAssignments
                .Where(assignment => assetIds.Contains(assignment.AssetId) &&
                                     assignment.AssetKindId == unclassified.Id)
                .Select(assignment => assignment.AssetId)
                .ToListAsync())
                .ToHashSet();

        // Replace only the catalogue assignment. Asset rows and their value
        // entries are deliberately retained as history.
        db.AssetKindAssignments.RemoveRange(assignments);
        foreach (var assetId in assetIds)
        {
            var asset = await db.Assets.FirstOrDefaultAsync(candidate => candidate.Id == assetId);
            if (asset is not null)
            {
                asset.AssetGroupId = null;
                asset.AssetGroupAssignmentSet = true;
            }

            if (!existingFallbackAssignments.Contains(assetId))
            {
                db.AssetKindAssignments.Add(new AssetKindAssignment
                {
                    AssetId = assetId,
                    AssetKindId = unclassified.Id
                });
            }
        }

        var alreadyArchived = kind.ArchivedAt.HasValue;
        kind.ArchivedAt ??= DateTimeOffset.UtcNow;

        return new AssetKindArchiveResult(
            kind.Id,
            kind.Code,
            alreadyArchived,
            assetIds.Count);
    }

    public static bool IsUnclassified(AssetKind kind) =>
        kind.Code.Equals(AssetKindCodes.Unclassified, StringComparison.OrdinalIgnoreCase);

    public static async Task<AssetKind?> FindAssetKindAsync(
        WealthDbContext db,
        string? code)
    {
        var normalized = NormalizeAssetKindCode(code);
        return await db.AssetKinds.FirstOrDefaultAsync(kind =>
            kind.ArchivedAt == null &&
            kind.Code.ToLower() == normalized);
    }

    public static async Task<Asset> EnsureAssetForEntryAsync(
        WealthDbContext db,
        AssetValueEntry entry,
        string? requestedDisplayName = null,
        IReadOnlyCollection<Guid>? assetKindIds = null,
        bool requireExplicitAsset = false)
    {
        EnsureDefaults(db);

        var kindCode = NormalizeAssetKindCode(entry.AssetKindCode);
        var selectedIds = assetKindIds?.Distinct().ToArray() ?? Array.Empty<Guid>();
        var selectedKinds = selectedIds.Length == 0
            ? new List<AssetKind>()
            : await db.AssetKinds
                .Where(kind => selectedIds.Contains(kind.Id) && kind.ArchivedAt == null)
                .ToListAsync();

        if (selectedKinds.Count != selectedIds.Length)
            throw new ArgumentException("One or more asset kinds are invalid.", nameof(assetKindIds));
        if (selectedKinds.Count > 1)
            throw new ArgumentException("Only one asset kind may be selected for an asset.", nameof(assetKindIds));

        if (selectedKinds.SingleOrDefault() is { } selectedKind && IsUnclassified(selectedKind) && requireExplicitAsset)
            throw new ArgumentException(
                "Unclassified is a system fallback and cannot be selected explicitly.",
                nameof(assetKindIds));

        var defaultKind = selectedKinds.SingleOrDefault()
                         ?? await FindAssetKindAsync(db, kindCode)
                         ?? await FindAssetKindAsync(db, AssetKindCodes.Unclassified)
                         ?? throw new ArgumentException("An active asset kind is required.");

        if (requireExplicitAsset && selectedKinds.Count == 0)
            throw new ArgumentException("An asset kind is required.", nameof(assetKindIds));

        Asset? asset = entry.AssetId != Guid.Empty
            ? db.Assets.Local.FirstOrDefault(existing => existing.Id == entry.AssetId)
              ?? await db.Assets.FirstOrDefaultAsync(existing => existing.Id == entry.AssetId)
            : null;

        var displayName = asset?.DisplayName
                          ?? (string.IsNullOrWhiteSpace(requestedDisplayName)
                              ? entry.Name.Trim()
                              : requestedDisplayName.Trim());
        if (string.IsNullOrWhiteSpace(displayName))
            throw new ArgumentException("An asset display name is required.", nameof(requestedDisplayName));

        if (asset is null)
        {
            var candidates = await db.Assets
                .Include(candidate => candidate.AssetKindAssignments)
                    .ThenInclude(assignment => assignment.AssetKind)
                .Where(candidate => candidate.ArchivedAt == null)
                .ToListAsync();
            asset = candidates.FirstOrDefault(candidate =>
                candidate.DisplayName.Equals(displayName, StringComparison.OrdinalIgnoreCase) &&
                candidate.AssetKindAssignments.Any(assignment => assignment.AssetKindId == defaultKind.Id));
        }

        var isNewAsset = asset is null;
        asset ??= new Asset { DisplayName = displayName };
        if (asset.Id == Guid.Empty)
            asset.Id = Guid.NewGuid();
        asset.DisplayName = asset.DisplayName.Trim();
        if (isNewAsset)
        {
            asset.AssetGroupId = await FindDefaultAssetGroupIdAsync(db, defaultKind.Id);
            asset.AssetGroupAssignmentSet = true;
            db.Assets.Add(asset);
        }

        entry.AssetId = asset.Id;
        entry.Name = asset.DisplayName;
        entry.AssetKindCode = defaultKind.Code;

        var assignments = await db.AssetKindAssignments
            .Where(assignment => assignment.AssetId == asset.Id)
            .ToListAsync();
        var current = assignments.FirstOrDefault();
        if (current is null)
        {
            db.AssetKindAssignments.Add(new AssetKindAssignment
            {
                AssetId = asset.Id,
                AssetKindId = defaultKind.Id
            });
        }
        else if (current.AssetKindId != defaultKind.Id)
        {
            current.AssetKindId = defaultKind.Id;
        }

        return asset;
    }

    public static async Task<Asset> EnsurePropertyAssetAsync(
        WealthDbContext db,
        Asset asset)
    {
        asset.DisplayName = asset.DisplayName.Trim();
        asset.ArchivedAt = asset.ArchivedAt;
        var propertyKind = await FindAssetKindAsync(db, AssetKindCodes.Property)
                           ?? throw new ArgumentException("The Property asset kind is unavailable.", nameof(asset));

        var assignment = await db.AssetKindAssignments
            .FirstOrDefaultAsync(candidate => candidate.AssetId == asset.Id);
        if (assignment is null)
        {
            db.AssetKindAssignments.Add(new AssetKindAssignment
            {
                AssetId = asset.Id,
                AssetKindId = propertyKind.Id
            });
        }
        else
        {
            assignment.AssetKindId = propertyKind.Id;
        }

        if (!asset.AssetGroupAssignmentSet && !asset.AssetGroupId.HasValue)
        {
            asset.AssetGroupId = await FindDefaultAssetGroupIdAsync(db, propertyKind.Id);
            asset.AssetGroupAssignmentSet = true;
        }

        var detail = await db.PropertyDetails.FindAsync(asset.Id);
        if (detail is null)
        {
            db.PropertyDetails.Add(new PropertyDetail
            {
                AssetId = asset.Id,
                Asset = asset
            });
        }

        return asset;
    }

    private static async Task<Guid?> FindDefaultAssetGroupIdAsync(WealthDbContext db, Guid assetKindId) =>
        await db.AssetKindGroups
            .Where(mapping => mapping.AssetKindId == assetKindId)
            .Select(mapping => (Guid?)mapping.AssetGroupId)
            .FirstOrDefaultAsync();

    public static async Task<ExternalValue?> FindExternalValueAsync(
        WealthDbContext db,
        Guid integrationAccountId,
        string? externalId)
    {
        if (string.IsNullOrWhiteSpace(externalId))
            return null;

        return await db.ExternalValues
            .FirstOrDefaultAsync(value =>
                value.IntegrationAccountId == integrationAccountId &&
                value.ExternalId == externalId);
    }

    public static async Task<ExternalValue> UpsertExternalValueAsync(
        WealthDbContext db,
        IntegrationAccount account,
        string externalId,
        string displayName,
        ExternalValueRole role,
        Guid? assetId = null)
    {
        if (string.IsNullOrWhiteSpace(externalId))
            throw new ArgumentException("An external value ID is required.", nameof(externalId));

        var value = await FindExternalValueAsync(db, account.Id, externalId.Trim());
        if (value is null)
        {
            value = new ExternalValue
            {
                IntegrationAccountId = account.Id,
                IntegrationAccount = account,
                ExternalId = externalId.Trim(),
                DisplayName = displayName,
                Role = role
            };
            db.ExternalValues.Add(value);
        }
        else
        {
            value.DisplayName = displayName;
            value.Role = role;
        }

        value.LastSeenAt = DateTimeOffset.UtcNow;
        if (assetId.HasValue)
        {
            var mapping = await db.ExternalValueAssetMappings.FindAsync(value.Id);
            if (mapping is null)
            {
                db.ExternalValueAssetMappings.Add(new ExternalValueAssetMapping
                {
                    ExternalValueId = value.Id,
                    AssetId = assetId.Value,
                    ExternalValue = value
                });
            }
            else
            {
                mapping.AssetId = assetId.Value;
            }
        }

        return value;
    }

    public static string NormalizeAssetKindCode(string? code)
    {
        var normalized = code?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "cash" => AssetKindCodes.Cash,
            "savings" => AssetKindCodes.Savings,
            "investments" or "investment" => AssetKindCodes.Investments,
            "pensions" or "pension" => AssetKindCodes.Pensions,
            "property" or "properties" => AssetKindCodes.Property,
            "bonds" or "bond" => AssetKindCodes.Bonds,
            _ => string.IsNullOrWhiteSpace(normalized) ? AssetKindCodes.Unclassified : normalized
        };
    }

    [Obsolete("Use NormalizeAssetKindCode.")]
    public static string NormalizeEntryType(string? type) => NormalizeAssetKindCode(type);

    public static string ValueShapeForKind(string? code) =>
        DefaultKinds.TryGetValue(NormalizeAssetKindCode(code), out var metadata)
            ? metadata.Shape
            : AssetValueShape.Cash;

    [Obsolete("Use ValueShapeForKind.")]
    public static string EntryKindForType(string? type) =>
        ValueShapeForKind(type);

    public static string DefaultAssetGroupForKind(string? code) =>
        DefaultKinds.TryGetValue(NormalizeAssetKindCode(code), out var metadata)
            ? metadata.Group ?? string.Empty
            : string.Empty;

    [Obsolete("Use DefaultAssetGroupForKind.")]
    public static string DefaultAssetClassForType(string? type) =>
        NormalizeAssetKindCode(type);
}

public sealed record AssetKindArchiveResult(
    Guid AssetKindId,
    string AssetKindCode,
    bool WasAlreadyArchived,
    int MigratedAssetCount);
