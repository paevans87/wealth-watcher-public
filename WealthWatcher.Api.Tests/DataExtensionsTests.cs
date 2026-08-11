using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Models;
using WealthWatcher.Api.Services;

namespace WealthWatcher.Api.Tests;

public class DataExtensionsTests
{
    [Fact]
    public void InitializeDatabase_seeds_the_current_asset_catalog()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Environment.EnvironmentName = Environments.Development;
        builder.Services.AddWealthData(builder.Configuration, builder.Environment);

        var app = builder.Build();
        app.InitializeDatabase();

        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();

        var liquidGroup = db.AssetGroups.Single(group => group.Code == AssetGroupCodes.Liquid);
        var illiquidGroup = db.AssetGroups.Single(group => group.Code == AssetGroupCodes.Illiquid);
        Assert.Equal("Liquid", liquidGroup.DisplayName);
        Assert.Equal("Illiquid", illiquidGroup.DisplayName);
        var bonds = db.AssetKinds.Single(kind => kind.Code == AssetKindCodes.Bonds);
        Assert.Contains(db.AssetKindGroups, mapping =>
            mapping.AssetKindId == bonds.Id && mapping.AssetGroupId == liquidGroup.Id);
    }

    [Fact]
    public void EnsureDefaults_is_idempotent()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Environment.EnvironmentName = Environments.Development;
        builder.Services.AddWealthData(builder.Configuration, builder.Environment);

        var app = builder.Build();
        app.InitializeDatabase();

        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        AssetCatalogService.EnsureDefaults(db);

        Assert.Equal(7, db.AssetKinds.Count());
        Assert.Equal(2, db.AssetGroups.Count());
    }
}
