using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Models;
using WealthWatcher.Api.Services;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class AssetCatalogTests
{
    [Fact]
    public async Task Asset_values_have_stable_records_and_can_be_used_by_entries()
    {
        await using var host = await TestHost.CreateAsync();

        var groups = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-groups", HttpMethods.Get), HttpMethods.Get));
        var assetGroup = groups.RootElement.EnumerateArray()
            .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.Assets);
        var assetValue = assetGroup.GetProperty("Values").EnumerateArray()
            .Single(value => value.GetProperty("Key").GetString() == "bonds");

        Assert.Equal("Asset", assetGroup.GetProperty("DisplayName").GetString());
        Assert.NotEqual(Guid.Empty, assetValue.GetProperty("Id").GetGuid());
        Assert.NotEqual("", assetValue.GetProperty("DisplayName").GetString());
        Assert.StartsWith("#", assetValue.GetProperty("Color").GetString());
        Assert.True(assetValue.GetProperty("DisplayOrder").GetInt32() > 0);

        var assetResponse = await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "NS&I",
                EntryKind = AssetEntryKind.Cash,
                ClassificationValueIds = [assetValue.GetProperty("Id").GetGuid()]
            });
        var assetDocument = await ReadJsonAsync(assetResponse);
        var assetId = assetDocument.RootElement.GetProperty("Id").GetGuid();

        var entryResponse = await host.InvokeAsync(
            host.Find("/api/wealth", HttpMethods.Post),
            HttpMethods.Post,
            new WealthEntryDto
            {
                AssetId = assetId,
                Name = "Renamed by provider",
                Type = "bonds",
                Value = 550m,
                Date = new DateOnly(2026, 8, 4),
                Time = TimeOnly.MinValue
            });
        var entryDocument = await ReadJsonAsync(entryResponse);

        Assert.Equal(assetId, entryDocument.RootElement.GetProperty("AssetId").GetGuid());
        await using var scope = host.App.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        var savedAsset = await db.Assets.SingleAsync(asset => asset.Id == assetId);
        var savedEntry = await db.AssetValueEntries.SingleAsync();
        Assert.Equal("NS&I", savedAsset.DisplayName);
        Assert.Equal(assetId, savedEntry.AssetId);
        Assert.Equal("NS&I", savedEntry.Name);
    }

    [Fact]
    public async Task Asset_group_can_move_without_changing_its_asset_kind()
    {
        await using var host = await TestHost.CreateAsync();
        var groups = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-groups", HttpMethods.Get), HttpMethods.Get));
        var assetKinds = groups.RootElement.EnumerateArray()
            .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.Assets);
        var bondsId = assetKinds.GetProperty("Values").EnumerateArray()
            .Single(value => value.GetProperty("Key").GetString() == AssetKindCodes.Bonds)
            .GetProperty("Id").GetGuid();
        var assetGroups = groups.RootElement.EnumerateArray()
            .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.AssetClasses);
        var liquidId = assetGroups.GetProperty("Values").EnumerateArray()
            .Single(value => value.GetProperty("Key").GetString() == AssetGroupCodes.Liquid)
            .GetProperty("Id").GetGuid();
        var illiquidId = assetGroups.GetProperty("Values").EnumerateArray()
            .Single(value => value.GetProperty("Key").GetString() == AssetGroupCodes.Illiquid)
            .GetProperty("Id").GetGuid();

        var created = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Move me",
                AssetKindId = bondsId,
                AssetGroupId = liquidId
            }));
        var assetId = created.RootElement.GetProperty("Id").GetGuid();

        var moved = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/assets/{id:guid}", HttpMethods.Patch),
            HttpMethods.Patch,
            new AssetUpdateDto
            {
                AssetGroupId = illiquidId,
                SetAssetGroup = true
            },
            routeValues: new Dictionary<string, string> { ["id"] = assetId.ToString() }));

        Assert.Equal(bondsId, moved.RootElement.GetProperty("AssetKindId").GetGuid());
        Assert.Equal(illiquidId, moved.RootElement.GetProperty("AssetGroupId").GetGuid());
        Assert.Equal(AssetGroupCodes.Illiquid, moved.RootElement.GetProperty("AssetGroupCode").GetString());

        await using var scope = host.App.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        Assert.Equal(illiquidId, (await db.Assets.SingleAsync(asset => asset.Id == assetId)).AssetGroupId);
        Assert.Equal(bondsId, (await db.AssetKindAssignments.SingleAsync(assignment => assignment.AssetId == assetId)).AssetKindId);

        var ungrouped = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/assets/{id:guid}", HttpMethods.Patch),
            HttpMethods.Patch,
            new AssetUpdateDto
            {
                SetAssetGroup = true
            },
            routeValues: new Dictionary<string, string> { ["id"] = assetId.ToString() }));

        Assert.Equal(JsonValueKind.Null, ungrouped.RootElement.GetProperty("AssetGroupId").ValueKind);
        Assert.Equal(bondsId, ungrouped.RootElement.GetProperty("AssetKindId").GetGuid());
        await using var ungroupedScope = host.App.Services.CreateAsyncScope();
        var ungroupedDb = ungroupedScope.ServiceProvider.GetRequiredService<WealthDbContext>();
        var savedUngroupedAsset = await ungroupedDb.Assets.SingleAsync(asset => asset.Id == assetId);
        Assert.Null(savedUngroupedAsset.AssetGroupId);
        Assert.True(savedUngroupedAsset.AssetGroupAssignmentSet);
    }

    [Fact]
    public async Task Catalogue_repair_removes_stale_unclassified_group_mappings()
    {
        await using var host = await TestHost.CreateAsync();
        await host.InvokeAsync(host.Find("/api/asset-kinds", HttpMethods.Get), HttpMethods.Get);

        Guid unclassifiedId;
        await using (var scope = host.App.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
            var unclassified = await db.AssetKinds.SingleAsync(kind => kind.Code == AssetKindCodes.Unclassified);
            var staleGroup = new AssetGroup
            {
                Code = "stale-unclassified-group",
                DisplayName = "Stale group",
                Color = "#64748b"
            };
            db.AssetGroups.Add(staleGroup);
            db.AssetKindGroups.Add(new AssetKindGroup
            {
                AssetKindId = unclassified.Id,
                AssetGroupId = staleGroup.Id
            });
            await db.SaveChangesAsync();
            unclassifiedId = unclassified.Id;
        }

        var kinds = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/asset-kinds", HttpMethods.Get), HttpMethods.Get));
        var unclassifiedResponse = kinds.RootElement.EnumerateArray()
            .Single(kind => kind.GetProperty("Id").GetGuid() == unclassifiedId);
        Assert.Equal(JsonValueKind.Null, unclassifiedResponse.GetProperty("AssetGroupId").ValueKind);

        await using var verifyScope = host.App.Services.CreateAsyncScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<WealthDbContext>();
        Assert.Empty(await verifyDb.AssetKindGroups
            .Where(mapping => mapping.AssetKindId == unclassifiedId)
            .ToListAsync());
    }

    [Fact]
    public async Task Unclassified_cannot_be_explicitly_selected_for_manual_asset_creation_or_archived()
    {
        await using var host = await TestHost.CreateAsync();
        var groups = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-groups", HttpMethods.Get), HttpMethods.Get));
        var unclassifiedId = groups.RootElement.EnumerateArray()
            .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.Assets)
            .GetProperty("Values").EnumerateArray()
            .Single(value => value.GetProperty("Key").GetString() == AssetKindCodes.Unclassified)
            .GetProperty("Id").GetGuid();

        var createException = await Assert.ThrowsAsync<InvalidOperationException>(() => host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Fallback asset",
                AssetKindId = unclassifiedId
            }));
        Assert.Contains("cannot be selected explicitly", createException.Message);

        var archiveException = await Assert.ThrowsAsync<InvalidOperationException>(() => host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Delete),
            HttpMethods.Delete,
            routeValues: new Dictionary<string, string> { ["id"] = unclassifiedId.ToString() }));
        Assert.Contains("cannot be archived", archiveException.Message);

        var entryException = await Assert.ThrowsAsync<InvalidOperationException>(() => host.InvokeAsync(
            host.Find("/api/wealth", HttpMethods.Post),
            HttpMethods.Post,
            new WealthEntryDto
            {
                Name = "Fallback entry",
                Type = AssetKindCodes.Unclassified,
                Value = 10m,
                Date = new DateOnly(2026, 8, 6),
                Time = TimeOnly.MinValue,
                Source = "Manual"
            }));
        Assert.Contains("cannot be selected explicitly", entryException.Message);
    }

    [Fact]
    public async Task Unknown_imported_kind_falls_back_to_unclassified()
    {
        await using var host = await TestHost.CreateAsync();
        await using var scope = host.App.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        db.Database.EnsureCreated();

        var entry = new CashAssetValueEntry(
            "Imported holding",
            "provider-specific-kind",
            75m,
            new DateOnly(2026, 8, 5),
            TimeOnly.MinValue,
            "Provider");
        var asset = await AssetCatalogService.EnsureAssetForEntryAsync(db, entry);
        await db.SaveChangesAsync();

        var unclassifiedId = await db.AssetKinds
            .Where(kind => kind.Code == AssetKindCodes.Unclassified)
            .Select(kind => kind.Id)
            .SingleAsync();
        Assert.Equal(AssetKindCodes.Unclassified, entry.AssetKindCode);
        Assert.Equal(unclassifiedId, (await db.AssetKindAssignments
            .SingleAsync(assignment => assignment.AssetId == asset.Id)).AssetKindId);
    }

    [Fact]
    public async Task Archiving_an_asset_kind_migrates_assignments_and_is_idempotent()
    {
        await using var host = await TestHost.CreateAsync();
        var kindId = await AddValueAsync(
            host,
            AssetClassificationKeys.Assets,
            "Brokerage",
            "brokerage");

        var asset = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Brokerage account",
                AssetKindId = kindId
            }));
        var assetId = asset.RootElement.GetProperty("Id").GetGuid();

        await host.InvokeAsync(
            host.Find("/api/wealth", HttpMethods.Post),
            HttpMethods.Post,
            new WealthEntryDto
            {
                AssetId = assetId,
                Name = "Brokerage account",
                Type = "brokerage",
                Value = 250m,
                Date = new DateOnly(2026, 8, 5),
                Time = TimeOnly.MinValue
            });

        var archiveResponse = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Delete),
            HttpMethods.Delete,
            routeValues: new Dictionary<string, string> { ["id"] = kindId.ToString() }));
        Assert.Equal(1, archiveResponse.RootElement.GetProperty("MigratedAssetCount").GetInt32());
        Assert.False(archiveResponse.RootElement.GetProperty("WasAlreadyArchived").GetBoolean());

        await using (var scope = host.App.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
            var unclassifiedId = await db.AssetKinds
                .Where(kind => kind.Code == AssetKindCodes.Unclassified)
                .Select(kind => kind.Id)
                .SingleAsync();
            Assert.True((await db.AssetKinds.SingleAsync(kind => kind.Id == kindId)).ArchivedAt.HasValue);
            Assert.Equal(unclassifiedId, (await db.AssetKindAssignments.SingleAsync(
                assignment => assignment.AssetId == assetId)).AssetKindId);
            Assert.Equal(250m, (await db.AssetValueEntries.SingleAsync()).Value);
        }

        var repeatResponse = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Delete),
            HttpMethods.Delete,
            routeValues: new Dictionary<string, string> { ["id"] = kindId.ToString() }));
        Assert.Equal(0, repeatResponse.RootElement.GetProperty("MigratedAssetCount").GetInt32());
        Assert.True(repeatResponse.RootElement.GetProperty("WasAlreadyArchived").GetBoolean());
    }

    [Fact]
    public async Task Archiving_an_asset_removes_its_current_balance_but_keeps_history()
    {
        await using var host = await TestHost.CreateAsync();

        var groups = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-groups", HttpMethods.Get), HttpMethods.Get));
        var assetValueId = groups.RootElement.EnumerateArray()
            .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.Assets)
            .GetProperty("Values").EnumerateArray()
            .Single(value => value.GetProperty("Key").GetString() == "bonds")
            .GetProperty("Id").GetGuid();

        var assetResponse = await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Archived bonds",
                EntryKind = AssetEntryKind.Cash,
                ClassificationValueIds = [assetValueId]
            });
        var assetId = (await ReadJsonAsync(assetResponse)).RootElement.GetProperty("Id").GetGuid();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        foreach (var (date, value) in new[]
        {
            (today.AddDays(-2), 100m),
            (today, 125m)
        })
        {
            await host.InvokeAsync(
                host.Find("/api/wealth", HttpMethods.Post),
                HttpMethods.Post,
                new WealthEntryDto
                {
                    AssetId = assetId,
                    Name = "Archived bonds",
                    Type = "bonds",
                    Value = value,
                    Date = date,
                    Time = TimeOnly.MinValue,
                    Source = "Manual"
                });
        }

        await host.InvokeAsync(
            host.Find("/api/assets/{id:guid}", HttpMethods.Patch),
            HttpMethods.Patch,
            new AssetUpdateDto { Archived = true },
            new Dictionary<string, string> { ["id"] = assetId.ToString() });

        using var aggregate = await host.InvokeAggregateAsync("bonds", "MAX");
        var data = (await ReadJsonAsync(aggregate)).RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(100m, data[0].GetProperty("Value").GetDecimal());
        Assert.Equal(0m, data[^1].GetProperty("Value").GetDecimal());
        Assert.Empty(data[^1].GetProperty("Breakdown").EnumerateObject());
    }

    [Fact]
    public async Task New_catalogue_values_generate_keys_from_display_names()
    {
        await using var host = await TestHost.CreateAsync();

        var response = await host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto
            {
                DisplayName = "Long term savings"
            },
            new Dictionary<string, string> { ["groupKey"] = AssetClassificationKeys.Assets });

        var value = await ReadJsonAsync(response);
        Assert.Equal("long_term_savings", value.RootElement.GetProperty("Key").GetString());
    }

    [Fact]
    public async Task Asset_kinds_can_be_added_updated_and_archived()
    {
        await using var host = await TestHost.CreateAsync();
        var groupId = await AddValueAsync(
            host,
            AssetClassificationKeys.AssetClasses,
            "Long term",
            "long-term");

        var created = await host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto
            {
                Key = "crypto",
                DisplayName = "Crypto",
                ParentValueId = groupId
            },
            new Dictionary<string, string> { ["groupKey"] = AssetClassificationKeys.Assets });
        var createdDocument = await ReadJsonAsync(created);
        var kindId = createdDocument.RootElement.GetProperty("Id").GetGuid();
        Assert.Equal(groupId, createdDocument.RootElement.GetProperty("ParentValueId").GetGuid());

        var updated = await host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Patch),
            HttpMethods.Patch,
            new ClassificationValueUpdateDto { DisplayName = "Digital assets", DisplayOrder = 12 },
            new Dictionary<string, string> { ["id"] = kindId.ToString() });
        var updatedDocument = await ReadJsonAsync(updated);
        Assert.Equal("Digital assets", updatedDocument.RootElement.GetProperty("DisplayName").GetString());
        Assert.Equal(12, updatedDocument.RootElement.GetProperty("DisplayOrder").GetInt32());

        await host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Delete),
            HttpMethods.Delete,
            routeValues: new Dictionary<string, string> { ["id"] = kindId.ToString() });

        var groups = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-groups", HttpMethods.Get), HttpMethods.Get));
        Assert.DoesNotContain(
            groups.RootElement.EnumerateArray()
                .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.Assets)
                .GetProperty("Values").EnumerateArray(),
            value => value.GetProperty("Id").GetGuid() == kindId);

        await using var scope = host.App.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        Assert.NotNull(await db.AssetKinds.SingleAsync(kind => kind.Id == kindId && kind.ArchivedAt.HasValue));
    }

    [Fact]
    public async Task Asset_class_is_optional_and_asset_values_can_be_mapped_to_one()
    {
        await using var host = await TestHost.CreateAsync();

        var assetValueResponse = await host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto
            {
                Key = "digital",
                DisplayName = "Digital assets",
                Color = "#22c55e"
            },
            new Dictionary<string, string> { ["groupKey"] = AssetClassificationKeys.Assets });
        var assetValueId = (await ReadJsonAsync(assetValueResponse)).RootElement.GetProperty("Id").GetGuid();

        var ungroupedAsset = await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Digital wallet",
                EntryKind = AssetEntryKind.Cash,
                ClassificationValueIds = [assetValueId]
            });
        var ungroupedDocument = await ReadJsonAsync(ungroupedAsset);
        Assert.DoesNotContain(
            ungroupedDocument.RootElement.GetProperty("Classifications").EnumerateArray(),
            value => value.GetProperty("ParentValueId").ValueKind != JsonValueKind.Null);

        var parentResponse = await host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto
            {
                Key = "long-term",
                DisplayName = "Long term",
                Color = "#8b5cf6"
            },
            new Dictionary<string, string> { ["groupKey"] = AssetClassificationKeys.AssetClasses });
        var parentId = (await ReadJsonAsync(parentResponse)).RootElement.GetProperty("Id").GetGuid();

        var mappedAssetResponse = await host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto
            {
                Key = "long-term-investments",
                DisplayName = "Long term investments",
                ParentValueId = parentId
            },
            new Dictionary<string, string> { ["groupKey"] = AssetClassificationKeys.Assets });
        var mappedAssetId = (await ReadJsonAsync(mappedAssetResponse)).RootElement.GetProperty("Id").GetGuid();

        var categories = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/categories", HttpMethods.Get), HttpMethods.Get));
        var category = categories.RootElement.EnumerateArray()
            .Single(value => value.GetProperty("Id").GetString() == "long-term-investments");
        Assert.Equal(parentId, category.GetProperty("AssetGroupId").GetGuid());
        Assert.Equal("Long term", category.GetProperty("AssetGroupName").GetString());

        var assetResponse = await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Long term account",
                EntryKind = AssetEntryKind.Investment,
                ClassificationValueIds = [mappedAssetId]
            });
        var assetDocument = await ReadJsonAsync(assetResponse);
        Assert.Contains(
            assetDocument.RootElement.GetProperty("Classifications").EnumerateArray(),
            value => value.GetProperty("Id").GetGuid() == parentId);
    }

    [Fact]
    public async Task Updating_an_asset_mapping_is_reflected_in_categories()
    {
        await using var host = await TestHost.CreateAsync();

        var parentId = await AddValueAsync(host, AssetClassificationKeys.AssetClasses, "Manual liquid", "manual-liquid");
        var assetValueId = await AddValueAsync(host, AssetClassificationKeys.Assets, "Manual bonds", "manual-bonds");

        var updatedValue = await host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Patch),
            HttpMethods.Patch,
            new ClassificationValueUpdateDto { ParentValueId = parentId },
            new Dictionary<string, string> { ["id"] = assetValueId.ToString() });
        var updatedDocument = await ReadJsonAsync(updatedValue);
        Assert.Equal(parentId, updatedDocument.RootElement.GetProperty("ParentValueId").GetGuid());

        var categories = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/categories", HttpMethods.Get), HttpMethods.Get));
        var category = categories.RootElement.EnumerateArray()
            .Single(value => value.GetProperty("Id").GetString() == "manual-bonds");
        Assert.Equal(parentId, category.GetProperty("AssetGroupId").GetGuid());
    }

    [Fact]
    public async Task Archiving_an_asset_class_unmaps_children_but_keeps_asset_history()
    {
        await using var host = await TestHost.CreateAsync();

        var parentId = await AddValueAsync(host, AssetClassificationKeys.AssetClasses, "Short term", "short-term");
        var assetValueId = await AddValueAsync(
            host,
            AssetClassificationKeys.Assets,
            "Short term savings",
            "short-term-savings",
            parentId);
        var assetDocument = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/assets", HttpMethods.Post),
            HttpMethods.Post,
            new AssetCreateDto
            {
                DisplayName = "Savings account",
                EntryKind = AssetEntryKind.Cash,
                ClassificationValueIds = [assetValueId]
            }));

        await host.InvokeAsync(
            host.Find("/api/classification-values/{id:guid}", HttpMethods.Delete),
            HttpMethods.Delete,
            routeValues: new Dictionary<string, string> { ["id"] = parentId.ToString() });

        var updatedAsset = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/assets/{id:guid}", HttpMethods.Get),
            HttpMethods.Get,
            routeValues: new Dictionary<string, string>
            {
                ["id"] = assetDocument.RootElement.GetProperty("Id").GetGuid().ToString()
            }));
        var child = updatedAsset.RootElement.GetProperty("Classifications").EnumerateArray()
            .Single(value => value.GetProperty("Id").GetGuid() == assetValueId);
        Assert.Equal(JsonValueKind.Null, child.GetProperty("ParentValueId").ValueKind);

        var groups = await ReadJsonAsync(await host.InvokeAsync(
            host.Find("/api/classification-groups", HttpMethods.Get), HttpMethods.Get));
        Assert.DoesNotContain(
            groups.RootElement.EnumerateArray()
                .Single(group => group.GetProperty("Key").GetString() == AssetClassificationKeys.Assets)
                .GetProperty("Values").EnumerateArray(),
            value => value.GetProperty("Id").GetGuid() == parentId);
    }

    [Fact]
    public async Task Unsupported_classification_groups_are_not_available()
    {
        await using var host = await TestHost.CreateAsync();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto { DisplayName = "Filter value" },
            new Dictionary<string, string> { ["groupKey"] = "tax-wrapper" }));

        Assert.Contains("Only Asset class and Asset values", exception.Message);
    }

    [Fact]
    public async Task Adding_an_asset_class_restores_an_archived_catalogue_container()
    {
        await using var host = await TestHost.CreateAsync();
        await using (var scope = host.App.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
            db.Database.EnsureCreated();
            db.AssetGroups.Add(new AssetGroup
            {
                Code = "custom-group",
                DisplayName = "Lane",
                IsSystem = false,
                ArchivedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var valueId = await AddValueAsync(
            host,
            AssetClassificationKeys.AssetClasses,
            "Lane",
            "custom-group");

        await using var verifyScope = host.App.Services.CreateAsyncScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<WealthDbContext>();
        var group = await verifyDb.AssetGroups.SingleAsync(candidate =>
            candidate.Code == "custom-group");
        Assert.Null(group.ArchivedAt);
        Assert.Equal("Lane", group.DisplayName);
        Assert.Contains(await verifyDb.AssetGroups.ToListAsync(), value => value.Id == valueId);
    }

    [Fact]
    public async Task Adding_a_catalogue_value_restores_an_archived_value_with_the_same_key()
    {
        await using var host = await TestHost.CreateAsync();
        Guid archivedValueId;
        await using (var scope = host.App.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
            db.Database.EnsureCreated();
            var group = new AssetGroup
            {
                Code = "archived-group",
                DisplayName = "Asset group",
                IsSystem = false
            };
            var value = new AssetKind
            {
                Code = "liquid",
                DisplayName = "Old liquid",
                Color = "#64748b",
                DisplayOrder = 99,
                ArchivedAt = DateTimeOffset.UtcNow
            };
            db.AssetGroups.Add(group);
            db.AssetKinds.Add(value);
            await db.SaveChangesAsync();
            archivedValueId = value.Id;
        }

        var restoredValueId = await AddValueAsync(
            host,
            AssetClassificationKeys.Assets,
            "Liquid",
            "liquid");

        await using var verifyScope = host.App.Services.CreateAsyncScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<WealthDbContext>();
        var restoredValue = await verifyDb.AssetKinds.SingleAsync(value => value.Id == archivedValueId);
        Assert.Equal(archivedValueId, restoredValueId);
        Assert.Null(restoredValue.ArchivedAt);
        Assert.Equal("Liquid", restoredValue.DisplayName);
        Assert.Equal(0, restoredValue.DisplayOrder);

        var duplicateException = await Assert.ThrowsAsync<InvalidOperationException>(() => AddValueAsync(
            host,
            AssetClassificationKeys.Assets,
            "Liquid again",
            "liquid"));
        Assert.Contains("A classification value with this key already exists", duplicateException.Message);
    }

    private static async Task<Guid> AddValueAsync(
        TestHost host,
        string groupKey,
        string displayName,
        string key,
        Guid? parentValueId = null)
    {
        var response = await host.InvokeAsync(
            host.Find("/api/classification-groups/{groupKey}/values", HttpMethods.Post),
            HttpMethods.Post,
            new ClassificationValueCreateDto
            {
                Key = key,
                DisplayName = displayName,
                ParentValueId = parentValueId
            },
            new Dictionary<string, string> { ["groupKey"] = groupKey });
        return (await ReadJsonAsync(response)).RootElement.GetProperty("Id").GetGuid();
    }

    private static async Task<JsonDocument> ReadJsonAsync(Stream response)
    {
        return await JsonDocument.ParseAsync(response);
    }

    private sealed class TestHost : IAsyncDisposable
    {
        public WebApplication App { get; }

        private TestHost(WebApplication app)
        {
            App = app;
        }

        public static Task<TestHost> CreateAsync()
        {
            var databaseName = $"asset-endpoints-{Guid.NewGuid()}";
            var builder = WebApplication.CreateBuilder();
            builder.Services.AddDbContext<WealthDbContext>(options =>
                options.UseInMemoryDatabase(databaseName));
            builder.Services.AddWealthCaching();
            builder.Services.AddSingleton(TimeProvider.System);
            builder.Services.ConfigureHttpJsonOptions(options =>
                options.SerializerOptions.PropertyNamingPolicy = null);

            var app = builder.Build();
            app.MapWealthEndpoints();
            return Task.FromResult(new TestHost(app));
        }

        public RouteEndpoint Find(string route, string method)
        {
            return ((IEndpointRouteBuilder)App).DataSources
                .SelectMany(source => source.Endpoints)
                .OfType<RouteEndpoint>()
                .Single(endpoint =>
                    endpoint.RoutePattern.RawText == route &&
                    endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) == true);
        }

        public async Task<Stream> InvokeAsync(
            RouteEndpoint endpoint,
            string method,
            object? body = null,
            IReadOnlyDictionary<string, string>? routeValues = null)
        {
            var context = new DefaultHttpContext { RequestServices = App.Services };
            context.Request.Method = method;
            context.Request.RouteValues = routeValues is null
                ? new RouteValueDictionary()
                : new RouteValueDictionary(routeValues.ToDictionary(pair => pair.Key, pair => (object?)pair.Value));
            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;
            if (body is not null)
            {
                context.Request.ContentType = "application/json";
                context.Request.Body = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(body));
                context.Request.ContentLength = context.Request.Body.Length;
                context.Features.Set<IHttpRequestBodyDetectionFeature>(new RequestBodyDetectionFeature());
            }

            await endpoint.RequestDelegate!(context);
            context.Response.Body.Position = 0;
            if (context.Response.StatusCode is < 200 or >= 300)
            {
                using var reader = new StreamReader(context.Response.Body, leaveOpen: true);
                throw new InvalidOperationException($"{context.Response.StatusCode}: {await reader.ReadToEndAsync()}");
            }

            return context.Response.Body;
        }

        public async Task<Stream> InvokeAggregateAsync(string category, string period)
        {
            var endpoint = Find("/api/wealth/{category}/aggregate", HttpMethods.Get);
            var context = new DefaultHttpContext { RequestServices = App.Services };
            context.Request.Method = HttpMethods.Get;
            context.Request.QueryString = QueryString.Create("period", period);
            context.Request.RouteValues["category"] = category;
            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;

            await endpoint.RequestDelegate!(context);
            context.Response.Body.Position = 0;
            if (context.Response.StatusCode is < 200 or >= 300)
            {
                using var reader = new StreamReader(context.Response.Body, leaveOpen: true);
                throw new InvalidOperationException($"{context.Response.StatusCode}: {await reader.ReadToEndAsync()}");
            }

            return context.Response.Body;
        }

        public ValueTask DisposeAsync() => App.DisposeAsync();

        private sealed class RequestBodyDetectionFeature : IHttpRequestBodyDetectionFeature
        {
            public bool CanHaveBody => true;
        }
    }
}
