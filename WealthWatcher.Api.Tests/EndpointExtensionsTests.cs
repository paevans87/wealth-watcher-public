using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Models;
using WealthWatcher.Api.Services;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class EndpointExtensionsTests
{
    [Fact]
    public async Task Forecast_endpoint_returns_an_empty_projection_without_history()
    {
        await using var host = await ForecastHost.CreateAsync([]);

        using var response = await host.PostForecastAsync(new ForecastRequest { Target = 100m });

        Assert.Empty(response.RootElement.GetProperty("Projection").EnumerateArray());
        Assert.Empty(response.RootElement.GetProperty("StackOrder").EnumerateArray());
    }

    [Fact]
    public async Task Calendar_endpoint_returns_one_month_payload_with_historic_and_current_values()
    {
        var asset = new Asset { DisplayName = "Current account" };
        await using var host = await ForecastHost.CreateAsync(
        [
            new CashEntry("Current account", AssetKindCodes.Cash, 100m, new DateOnly(2026, 8, 9), TimeOnly.MinValue)
            {
                AssetId = asset.Id,
                Asset = asset
            },
            new CashEntry("Current account", AssetKindCodes.Cash, 110m, new DateOnly(2026, 8, 11), TimeOnly.MinValue)
            {
                AssetId = asset.Id,
                Asset = asset
            }
        ],
        Utc(2026, 8, 11, 12, 0),
        [asset]);

        using var response = await host.GetCalendarAsync(2026, 8);
        var days = response.RootElement.GetProperty("Days").EnumerateArray().ToArray();
        var historicDay = days.Single(day => day.GetProperty("Date").GetString() == "2026-08-09");
        var currentDay = days.Single(day => day.GetProperty("Date").GetString() == "2026-08-11");

        Assert.Equal(100m, historicDay.GetProperty("Total").GetDecimal());
        Assert.Equal(110m, currentDay.GetProperty("Total").GetDecimal());
        Assert.True(currentDay.GetProperty("HasObservation").GetBoolean());
        Assert.True(response.RootElement.GetProperty("MonthComparison").GetProperty("Available").GetBoolean());
    }

    [Fact]
    public async Task Dashboard_and_history_endpoints_return_all_categories_in_one_response()
    {
        var asset = new Asset { DisplayName = "Current account" };
        var investmentAsset = new Asset { DisplayName = "Pension" };
        await using var host = await ForecastHost.CreateAsync(
        [
            new CashEntry("Current account", AssetKindCodes.Cash, 100m, new DateOnly(2026, 8, 9), TimeOnly.MinValue)
            {
                AssetId = asset.Id,
                Asset = asset
            },
            new InvestmentEntry("Pension", AssetKindCodes.Investments, 250m, null, new DateOnly(2026, 8, 9), TimeOnly.MinValue)
            {
                AssetId = investmentAsset.Id,
                Asset = investmentAsset
            }
        ],
        Utc(2026, 8, 11, 12, 0),
        [asset, investmentAsset]);

        using var dashboard = await host.GetDashboardAsync("1M");
        using var history = await host.GetHistoryAsync("1M");

        Assert.Contains(dashboard.RootElement.GetProperty("Categories").EnumerateArray(),
            category => category.GetProperty("Id").GetString() == AssetKindCodes.Cash);
        Assert.Contains(dashboard.RootElement.GetProperty("Categories").EnumerateArray(),
            category => category.GetProperty("Id").GetString() == AssetKindCodes.Investments);
        Assert.True(history.RootElement.GetProperty("Timeline").GetArrayLength() >= 2);
    }

    [Fact]
    public async Task Aggregate_keeps_snaptrade_total_and_undeployed_cash_separate_for_one_asset()
    {
        var asset = new Asset { DisplayName = "AJ Bell - SIPP" };

        var timestamp = Utc(2026, 8, 4, 20, 11);
        var main = new InvestmentEntry(
            asset.DisplayName,
            "pensions",
            127111.44m,
            null,
            DateOnly.FromDateTime(timestamp),
            TimeOnly.FromDateTime(timestamp))
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:account-1:investments"
        };
        var undeployed = new CashEntry(
            $"{asset.DisplayName} (undeployed)",
            "cash",
            65.44m,
            DateOnly.FromDateTime(timestamp),
            TimeOnly.FromDateTime(timestamp))
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:account-1:cash"
        };

        await using var host = await ForecastHost.CreateAsync(
            [main, undeployed],
            Utc(2026, 8, 4, 21, 0),
            [asset]);

        using var response = await host.GetAggregateAsync("pensions", "MAX");
        var breakdown = response.RootElement.GetProperty("LatestBreakdown");

        Assert.Equal(127111.44m, breakdown.GetProperty("AJ Bell - SIPP").GetDecimal());
        Assert.Equal(65.44m, breakdown.GetProperty("AJ Bell - SIPP (undeployed)").GetDecimal());
    }

    [Fact]
    public async Task Aggregate_uses_the_current_account_allocation_when_history_keeps_an_old_asset_id()
    {
        var oldCashAsset = new Asset { DisplayName = "Legacy AJ Bell cash" };
        var currentCashAsset = new Asset { DisplayName = "AJ Bell - SIPP (undeployed)" };
        var timestamp = Utc(2026, 8, 4, 20, 11);
        var cashEntry = new CashEntry(
            oldCashAsset.DisplayName,
            AssetKindCodes.Cash,
            65.44m,
            DateOnly.FromDateTime(timestamp),
            TimeOnly.FromDateTime(timestamp))
        {
            AssetId = oldCashAsset.Id,
            Asset = oldCashAsset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:account-1:cash"
        };

        await using var host = await ForecastHost.CreateAsync(
            [cashEntry],
            Utc(2026, 8, 4, 21, 0),
            [oldCashAsset, currentCashAsset],
            [new IntegrationConnection { ProviderKey = "snaptrade", DisplayName = "AJ Bell" }]);

        var db = host.Db;
        var pensions = await db.AssetKinds.SingleAsync(kind => kind.Code == AssetKindCodes.Pensions);
        var oldAssignments = await db.AssetKindAssignments
            .Where(assignment => assignment.AssetId == currentCashAsset.Id)
            .ToListAsync();
        db.AssetKindAssignments.RemoveRange(oldAssignments);
        db.AssetKindAssignments.Add(new AssetKindAssignment
        {
            AssetId = currentCashAsset.Id,
            AssetKindId = pensions.Id
        });
        var account = await db.IntegrationAccounts.SingleAsync();
        db.IntegrationAccountAssetMappings.Add(new IntegrationAccountAssetMapping
        {
            IntegrationAccountId = account.Id,
            Role = ExternalValueRole.Undeployed,
            AssetId = currentCashAsset.Id
        });
        await db.SaveChangesAsync();

        using var response = await host.GetAggregateAsync(AssetKindCodes.Pensions, "MAX");
        var breakdown = response.RootElement.GetProperty("LatestBreakdown");

        Assert.True(breakdown.TryGetProperty(currentCashAsset.DisplayName, out var currentValue),
            response.RootElement.GetRawText());
        Assert.Equal(65.44m, currentValue.GetDecimal());
    }

    [Fact]
    public async Task Aggregate_current_provider_values_replace_legacy_values_with_the_same_name()
    {
        var asset = new Asset { DisplayName = "AJ Bell - SIPP" };
        var staleAsset = new Asset { DisplayName = "AJ Bell - SIPP (undeployed)" };

        var legacyDate = new DateOnly(2026, 8, 1);
        var currentDate = new DateOnly(2026, 8, 3);
        var legacyMain = new InvestmentEntry("AJ Bell - SIPP", "pensions", 100m, null, legacyDate, TimeOnly.MinValue)
        {
            AssetId = asset.Id,
            Asset = asset
        };
        var legacyCash = new CashEntry("AJ Bell - SIPP (undeployed)", "pensions", 10m, legacyDate, TimeOnly.MinValue)
        {
            AssetId = staleAsset.Id,
            Asset = staleAsset
        };
        var obsoleteProviderMain = new InvestmentEntry("AJ Bell - SIPP", "pensions", 90m, null, new DateOnly(2026, 8, 2), TimeOnly.MinValue)
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "SnaptradeProvider",
            ExternalAssetId = "legacy-account:investments"
        };
        var currentMain = new InvestmentEntry("AJ Bell - SIPP", "pensions", 120m, null, currentDate, TimeOnly.MinValue)
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:current:investments"
        };
        var currentCash = new CashEntry("AJ Bell - SIPP (undeployed)", "cash", 5m, currentDate, TimeOnly.MinValue)
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:current:cash"
        };

        await using var host = await ForecastHost.CreateAsync(
            [legacyMain, legacyCash, obsoleteProviderMain, currentMain, currentCash],
            Utc(2026, 8, 4, 12, 0),
            [asset, staleAsset],
            [new IntegrationConnection { ProviderKey = "snaptrade", DisplayName = "AJ Bell" }]);

        using var response = await host.GetAggregateAsync("pensions", "MAX");
        var breakdown = response.RootElement.GetProperty("LatestBreakdown");

        Assert.Equal(120m, breakdown.GetProperty("AJ Bell - SIPP").GetDecimal());
        Assert.Equal(5m, breakdown.GetProperty("AJ Bell - SIPP (undeployed)").GetDecimal());
    }

    [Fact]
    public async Task Aggregate_one_hour_consolidates_updates_carries_forward_and_excludes_previous_and_future_observations()
    {
        var now = Utc(2026, 6, 15, 13, 37);
        await using var host = await ForecastHost.CreateAsync(
        [
            InvestmentAt("Fund", 100m, 80m, Utc(2026, 6, 14, 23, 15)),
            InvestmentAt("Fund", 105m, 85m, Utc(2026, 6, 15, 0, 15)),
            InvestmentAt("Fund", 110m, 90m, Utc(2026, 6, 15, 0, 30)),
            InvestmentAt("Bond", 50m, 40m, Utc(2026, 6, 15, 1, 10)),
            InvestmentAt("Fund", 120m, 95m, Utc(2026, 6, 15, 3, 15)),
            InvestmentAt("Fund", 999m, 999m, Utc(2026, 6, 15, 14, 0)),
            InvestmentAt("Fund", 888m, 888m, Utc(2026, 6, 16, 1, 0))
        ], now);

        using var response = await host.GetAggregateAsync("investments", "1H", "Europe/London");
        var data = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(15, data.Length);
        AssertHourlyTimeline(data, "Europe/London", new DateTime(2026, 6, 15, 0, 0, 0), new DateTime(2026, 6, 15, 14, 0, 0));
        Assert.Equal(100m, data[0].GetProperty("Value").GetDecimal());
        Assert.Equal(80m, data[0].GetProperty("Invested").GetDecimal());
        Assert.Equal(110m, data[1].GetProperty("Value").GetDecimal());
        Assert.Equal(90m, data[1].GetProperty("Invested").GetDecimal());
        Assert.Equal(110m, data[1].GetProperty("Breakdown").GetProperty("Fund").GetDecimal());
        Assert.Equal(160m, data[2].GetProperty("Value").GetDecimal());
        Assert.Equal(130m, data[2].GetProperty("Invested").GetDecimal());
        Assert.Equal(170m, data[4].GetProperty("Value").GetDecimal());
        Assert.Equal(135m, data[4].GetProperty("Invested").GetDecimal());
        Assert.Equal(170m, data[^1].GetProperty("Value").GetDecimal());
    }

    [Fact]
    public async Task Aggregate_one_hour_omits_leading_hours_until_a_current_day_value_is_known()
    {
        await using var host = await ForecastHost.CreateAsync(
        [
            InvestmentAt("Fund", 222m, 200m, Utc(2026, 6, 15, 4, 10))
        ], Utc(2026, 6, 15, 10, 30));

        using var response = await host.GetAggregateAsync("investments", "1H", "Etc/UTC");
        var data = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(7, data.Length);
        AssertHourlyTimeline(data, "Etc/UTC", new DateTime(2026, 6, 15, 4, 0, 0), new DateTime(2026, 6, 15, 10, 0, 0));
        Assert.All(data, point =>
        {
            Assert.Equal(222m, point.GetProperty("Value").GetDecimal());
            Assert.Equal(200m, point.GetProperty("Invested").GetDecimal());
        });
    }

    [Fact]
    public async Task Aggregate_one_hour_uses_the_requested_timezone_for_local_day_boundaries()
    {
        await using var host = await ForecastHost.CreateAsync(
        [
            InvestmentAt("Fund", 100m, 90m, Utc(2026, 3, 9, 3, 30)),
            InvestmentAt("Fund", 120m, 100m, Utc(2026, 3, 9, 4, 15))
        ], Utc(2026, 3, 10, 3, 30));

        using var response = await host.GetAggregateAsync("investments", "1H", "America/New_York");
        var data = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(24, data.Length);
        AssertHourlyTimeline(data, "America/New_York", new DateTime(2026, 3, 9, 0, 0, 0), new DateTime(2026, 3, 9, 23, 0, 0));
        Assert.Equal(120m, data[0].GetProperty("Value").GetDecimal());
        Assert.DoesNotContain(data, point => ParseBucketStart(point).Date != new DateTime(2026, 3, 9));
    }

    [Fact]
    public async Task Aggregate_one_hour_respects_spring_forward_and_fallback_intervals()
    {
        await using var springHost = await ForecastHost.CreateAsync(
        [InvestmentAt("Fund", 100m, 80m, Utc(2026, 3, 8, 4, 30))], Utc(2026, 3, 8, 8, 30));
        using var springResponse = await springHost.GetAggregateAsync("investments", "1H", "America/New_York");
        var springData = springResponse.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(4, springData.Length);
        Assert.DoesNotContain(springData, point => ParseBucketStart(point).Hour == 2);

        await using var fallbackHost = await ForecastHost.CreateAsync(
        [InvestmentAt("Fund", 100m, 80m, Utc(2026, 11, 1, 3, 30))], Utc(2026, 11, 1, 7, 30));
        using var fallbackResponse = await fallbackHost.GetAggregateAsync("investments", "1H", "America/New_York");
        var fallbackData = fallbackResponse.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        var repeatedOneAm = fallbackData.Where(point => ParseBucketStart(point).Hour == 1).Select(ParseBucketStart).ToArray();
        Assert.Equal(4, fallbackData.Length);
        Assert.Equal(2, repeatedOneAm.Length);
        Assert.NotEqual(repeatedOneAm[0].Offset, repeatedOneAm[1].Offset);
    }

    [Fact]
    public async Task Aggregate_daily_regression_is_unchanged()
    {
        await using var host = await ForecastHost.CreateAsync(
        [
            InvestmentAt("Fund", 100m, 80m, Utc(2026, 6, 13, 12, 0)),
            InvestmentAt("Fund", 120m, 90m, Utc(2026, 6, 15, 12, 0))
        ], Utc(2026, 6, 15, 13, 0));

        using var response = await host.GetAggregateAsync("investments", "1D");
        var data = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(new[] { "2026-06-14", "2026-06-15" }, data.Select(point => point.GetProperty("Time").GetString()));
        Assert.Equal(100m, data[0].GetProperty("Value").GetDecimal());
        Assert.Equal(120m, data[1].GetProperty("Value").GetDecimal());
        Assert.False(data[0].GetProperty("HasObservation").GetBoolean());
        Assert.True(data[1].GetProperty("HasObservation").GetBoolean());
    }

    [Fact]
    public async Task Aggregate_daily_marks_a_flat_observed_balance_as_observed()
    {
        await using var host = await ForecastHost.CreateAsync(
        [
            InvestmentAt("Fund", 100m, 80m, Utc(2026, 6, 13, 12, 0)),
            InvestmentAt("Fund", 100m, 80m, Utc(2026, 6, 15, 12, 0))
        ], Utc(2026, 6, 15, 13, 0));

        using var response = await host.GetAggregateAsync("investments", "1D");
        var data = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(100m, data[0].GetProperty("Value").GetDecimal());
        Assert.Equal(100m, data[1].GetProperty("Value").GetDecimal());
        Assert.False(data[0].GetProperty("HasObservation").GetBoolean());
        Assert.True(data[1].GetProperty("HasObservation").GetBoolean());
    }

    [Fact]
    public async Task Aggregate_daily_and_hourly_ignore_future_same_day_observations_consistently()
    {
        var now = Utc(2026, 6, 15, 13, 0);
        await using var host = await ForecastHost.CreateAsync(
        [
            InvestmentAt("Fund", 100m, 80m, Utc(2026, 6, 14, 12, 0)),
            InvestmentAt("Fund", 120m, 90m, Utc(2026, 6, 15, 12, 0)),
            InvestmentAt("Fund", 999m, 999m, Utc(2026, 6, 15, 14, 0))
        ], now);

        using var hourlyResponse = await host.GetAggregateAsync("investments", "1H", "Etc/UTC");
        using var weeklyResponse = await host.GetAggregateAsync("investments", "1W");

        var hourlyData = hourlyResponse.RootElement.GetProperty("Data").EnumerateArray().ToArray();
        var weeklyData = weeklyResponse.RootElement.GetProperty("Data").EnumerateArray().ToArray();

        Assert.Equal(120m, hourlyData[^1].GetProperty("Value").GetDecimal());
        Assert.Equal(120m, weeklyData[^1].GetProperty("Value").GetDecimal());
    }

    [Fact]
    public async Task Aggregate_caches_only_historical_as_of_dates_and_reads_current_day_live()
    {
        var now = Utc(2026, 8, 10, 13, 0);
        var asset = new Asset { DisplayName = "Fund" };
        var historicalDate = new DateOnly(2026, 8, 9);
        await using var host = await ForecastHost.CreateAsync(
        [
            new InvestmentEntry("Fund", "investments", 100m, null, historicalDate, new TimeOnly(12, 0))
            {
                AssetId = asset.Id,
                Asset = asset
            }
        ], now, [asset]);

        using var firstHistorical = await host.GetAggregateAsync(
            "investments",
            "MAX",
            asOfDate: historicalDate);
        Assert.Equal(100m, firstHistorical.RootElement.GetProperty("Data")
            .EnumerateArray().Last().GetProperty("Value").GetDecimal());

        host.Db.AssetValueEntries.AddRange(
            new InvestmentEntry("Fund", "investments", 110m, null, historicalDate, new TimeOnly(15, 0))
            {
                AssetId = asset.Id
            },
            new InvestmentEntry("Fund", "investments", 125m, null, new DateOnly(2026, 8, 10), new TimeOnly(12, 0))
            {
                AssetId = asset.Id
            });
        await host.Db.SaveChangesAsync();

        using var cachedHistorical = await host.GetAggregateAsync(
            "investments",
            "MAX",
            asOfDate: historicalDate);
        Assert.Equal(100m, cachedHistorical.RootElement.GetProperty("Data")
            .EnumerateArray().Last().GetProperty("Value").GetDecimal());

        using var firstCurrent = await host.GetAggregateAsync("investments", "MAX");
        Assert.Equal(125m, firstCurrent.RootElement.GetProperty("Data")
            .EnumerateArray().Last().GetProperty("Value").GetDecimal());

        host.Db.AssetValueEntries.Add(new InvestmentEntry(
            "Fund", "investments", 130m, null, new DateOnly(2026, 8, 10), new TimeOnly(12, 30))
        {
            AssetId = asset.Id
        });
        await host.Db.SaveChangesAsync();

        using var secondCurrent = await host.GetAggregateAsync("investments", "MAX");
        Assert.Equal(130m, secondCurrent.RootElement.GetProperty("Data")
            .EnumerateArray().Last().GetProperty("Value").GetDecimal());
    }

    [Fact]
    public async Task Property_aggregate_returns_each_property_and_combined_totals_without_ltv()
    {
        await using var host = await ForecastHost.CreateAsync(
        [
            new PropertyEntry("Home", "property", 200m, 100m, DateOnly.FromDateTime(Utc(2026, 6, 13, 12, 0)), TimeOnly.MinValue),
            new PropertyEntry("Rental", "property", 300m, 200m, DateOnly.FromDateTime(Utc(2026, 6, 14, 12, 0)), TimeOnly.MinValue),
            new PropertyEntry("Home", "property", 210m, 90m, DateOnly.FromDateTime(Utc(2026, 6, 15, 12, 0)), TimeOnly.MinValue)
        ], Utc(2026, 6, 15, 13, 0));

        using var response = await host.GetAggregateAsync("property", "MAX");
        var details = response.RootElement.GetProperty("PropertyDetails");
        var properties = details.GetProperty("Properties").EnumerateArray().ToArray();

        Assert.Equal(new[] { "Home", "Rental" }, properties.Select(property => property.GetProperty("Name").GetString()));
        Assert.Equal(210m, properties[0].GetProperty("Value").GetDecimal());
        Assert.Equal(90m, properties[0].GetProperty("Mortgage").GetDecimal());
        Assert.Equal(120m, properties[0].GetProperty("Equity").GetDecimal());
        Assert.Equal(300m, properties[1].GetProperty("Value").GetDecimal());
        Assert.Equal(200m, properties[1].GetProperty("Mortgage").GetDecimal());
        Assert.Equal(100m, properties[1].GetProperty("Equity").GetDecimal());

        var totals = details.GetProperty("Totals");
        Assert.Equal(510m, totals.GetProperty("Value").GetDecimal());
        Assert.Equal(290m, totals.GetProperty("Mortgage").GetDecimal());
        Assert.Equal(220m, totals.GetProperty("Equity").GetDecimal());
        Assert.False(details.TryGetProperty("LTV", out _));
        var history = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();
        Assert.Equal(220m, history[^1].GetProperty("Value").GetDecimal());
    }

    [Fact]
    public async Task Property_create_update_and_archive_routes_keep_history_but_remove_current_property()
    {
        await using var host = await ForecastHost.CreateAsync(
        [new CashEntry("Seed", "cash", 1m, DateOnly.FromDateTime(Utc(2026, 6, 15, 12, 0)), TimeOnly.MinValue)],
        Utc(2026, 6, 15, 13, 0));

        var created = await host.PostPropertyAsync(new PropertyCreateDto
        {
            Name = "Home",
            Value = 200m,
            Mortgage = 100m,
            Date = DateOnly.FromDateTime(Utc(2026, 6, 13, 12, 0)),
            Time = TimeOnly.MinValue
        });
        Assert.Equal(StatusCodes.Status200OK, created.StatusCode);
        var propertyId = created.Body!.RootElement.GetProperty("Id").GetGuid();

        var second = await host.PostPropertyAsync(new PropertyCreateDto
        {
            Name = "Rental",
            Value = 300m,
            Mortgage = 200m,
            Date = DateOnly.FromDateTime(Utc(2026, 6, 14, 12, 0)),
            Time = TimeOnly.MinValue
        });
        Assert.Equal(StatusCodes.Status200OK, second.StatusCode);

        var update = await host.PostPropertySnapshotAsync(propertyId, new PropertySnapshotDto
        {
            Value = 210m,
            Mortgage = 90m,
            Date = DateOnly.FromDateTime(Utc(2026, 6, 15, 12, 0)),
            Time = TimeOnly.MinValue
        });
        Assert.Equal(StatusCodes.Status200OK, update.StatusCode);

        var archive = await host.PatchPropertyAsync(propertyId, new PropertyUpdateDto { Archived = true });
        Assert.Equal(StatusCodes.Status200OK, archive.StatusCode);

        using var response = await host.GetAggregateAsync("property", "MAX");
        var details = response.RootElement.GetProperty("PropertyDetails");
        var properties = details.GetProperty("Properties").EnumerateArray().ToArray();
        Assert.Single(properties);
        Assert.Equal("Rental", properties[0].GetProperty("Name").GetString());
        Assert.Equal(100m, properties[0].GetProperty("Equity").GetDecimal());

        var history = response.RootElement.GetProperty("Data").EnumerateArray().ToArray();
        Assert.Equal(100m, history[0].GetProperty("Value").GetDecimal());
        Assert.Equal(200m, history[1].GetProperty("Value").GetDecimal());
        Assert.Equal(100m, history[^1].GetProperty("Value").GetDecimal());
    }

    [Fact]
    public async Task Forecast_compounds_each_entity_at_its_own_rate_and_uses_property_equity()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstObservation = today.AddDays(-60);
        await using var host = await ForecastHost.CreateAsync(
        [
            new InvestmentEntry("Growth fund", "investments", 100m, null, firstObservation, TimeOnly.MinValue),
            new InvestmentEntry("Growth fund", "investments", 121m, null, today, TimeOnly.MinValue),
            new InvestmentEntry("Flat pension", "pensions", 100m, null, firstObservation, TimeOnly.MinValue),
            new InvestmentEntry("Flat pension", "pensions", 100m, null, today, TimeOnly.MinValue),
            new PropertyEntry("Home", "property", 200m, 100m, firstObservation, TimeOnly.MinValue),
            new PropertyEntry("Home", "property", 242m, 100m, today, TimeOnly.MinValue),
            new CashEntry("Excluded cash", "cash", 10_000m, firstObservation, TimeOnly.MinValue),
            new CashEntry("Excluded cash", "cash", 20_000m, today, TimeOnly.MinValue)
        ]);

        var response = await host.PostForecastAsync(new ForecastRequest { Target = 380m });
        var trend = response.RootElement.GetProperty("HistoricalTrend");

        Assert.Equal(363d, trend[0].GetProperty("Total").GetDouble(), 6);

        Assert.Equal(363d, trend[1].GetProperty("Total").GetDouble(), 6);
        Assert.Equal(-1, response.RootElement.GetProperty("TrendTargetHitMonth").GetInt32());
    }

    [Fact]
    public async Task Forecast_endpoint_uses_first_last_annualized_strategy()
    {
        await using var host = await ForecastHost.CreateAsync(
        [
            new InvestmentEntry("Growth fund", "investments", 100m, null,
                new DateOnly(2025, 1, 1), TimeOnly.MinValue),
            new InvestmentEntry("Growth fund", "investments", 120m, null,
                new DateOnly(2026, 1, 1), TimeOnly.MinValue)
        ]);

        using var response = await host.PostForecastAsync(new ForecastRequest {
            Target = 100_000m,
            AnnualReturn = 6m,
            ForecastStrategy = ForecastCalculator.FirstLastAnnualizedStrategy,
            IncludedAssets = ["investments"]
        });

        Assert.Equal(ForecastCalculator.FirstLastAnnualizedStrategy,
            response.RootElement.GetProperty("SelectedStrategy").GetString());
        Assert.Contains("first and last", response.RootElement
            .GetProperty("SelectedStrategyDescription").GetString(), StringComparison.OrdinalIgnoreCase);
        var rate = Assert.Single(response.RootElement.GetProperty("RateSources").EnumerateArray());
        Assert.Equal(20d, rate.GetProperty("AnnualRatePercent").GetDouble(), 8);
        Assert.Equal(ForecastCalculator.FirstLastAnnualizedStrategy,
            rate.GetProperty("Source").GetString());
    }

    [Fact]
    public async Task Forecast_keeps_snaptrade_total_and_undeployed_cash_separate_for_one_asset()
    {
        var asset = new Asset { DisplayName = "AJ Bell - SIPP" };

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var main = new InvestmentEntry(
            "SIPP",
            "pensions",
            1_000m,
            null,
            today,
            new TimeOnly(12, 0))
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:account-1:investments"
        };
        var undeployed = new CashEntry(
            "SIPP",
            "cash",
            65m,
            today,
            new TimeOnly(12, 1))
        {
            AssetId = asset.Id,
            Asset = asset,
            ProviderKey = "snaptrade",
            ExternalAssetId = "account:account-1:cash"
        };

        await using var host = await ForecastHost.CreateAsync(
            [main, undeployed],
            Utc(today.Year, today.Month, today.Day, 13, 0),
            [asset],
            [new IntegrationConnection { ProviderKey = "snaptrade" }]);

        using var response = await host.PostForecastAsync(new ForecastRequest
        {
            Target = 1_000_000m,
            AnnualReturn = 0m,
            IncludedAssets = ["pensions"]
        });

        Assert.Equal(1_065m, response.RootElement.GetProperty("CurrentNW").GetDecimal());
        var rateNames = response.RootElement.GetProperty("RateSources")
            .EnumerateArray()
            .Select(rate => rate.GetProperty("AssetName").GetString())
            .ToArray();
        Assert.Contains("AJ Bell - SIPP", rateNames);
        Assert.Contains("AJ Bell - SIPP (undeployed)", rateNames);
    }

    [Fact]
    public async Task Forecast_preserves_manual_undeployed_name_after_asset_reassignment()
    {
        var asset = new Asset { DisplayName = "AJ Bell - SIPP" };

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var main = new InvestmentEntry(
            asset.DisplayName,
            "pensions",
            1_000m,
            null,
            today,
            new TimeOnly(12, 0))
        {
            AssetId = asset.Id,
            Asset = asset
        };
        var undeployed = new CashEntry(
            $"{asset.DisplayName} (undeployed)",
            "pensions",
            65m,
            today,
            new TimeOnly(12, 1))
        {
            AssetId = asset.Id,
            Asset = asset
        };

        await using var host = await ForecastHost.CreateAsync(
            [main, undeployed],
            Utc(today.Year, today.Month, today.Day, 13, 0),
            [asset]);

        using var response = await host.PostForecastAsync(new ForecastRequest
        {
            Target = 1_000_000m,
            AnnualReturn = 0m,
            IncludedAssets = ["pensions"]
        });

        Assert.Equal(1_065m, response.RootElement.GetProperty("CurrentNW").GetDecimal());
        var rateNames = response.RootElement.GetProperty("RateSources")
            .EnumerateArray()
            .Select(rate => rate.GetProperty("AssetName").GetString())
            .ToArray();
        Assert.Contains("AJ Bell - SIPP", rateNames);
        Assert.Contains("AJ Bell - SIPP (undeployed)", rateNames);
    }

    [Fact]
    public async Task Forecast_excludes_cash_and_gives_invalid_or_short_histories_a_zero_rate()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        await using var host = await ForecastHost.CreateAsync(
        [
            new InvestmentEntry("Single", "investments", 100m, null, today, TimeOnly.MinValue),
            new InvestmentEntry("Short", "pensions", 200m, null, today.AddDays(-29), TimeOnly.MinValue),
            new InvestmentEntry("Short", "pensions", 250m, null, today, TimeOnly.MinValue),
            new InvestmentEntry("Zero start", "investments", 0m, null, today.AddDays(-60), TimeOnly.MinValue),
            new InvestmentEntry("Zero start", "investments", 50m, null, today, TimeOnly.MinValue),
            new PropertyEntry("Negative equity", "property", 100m, 150m, today.AddDays(-60), TimeOnly.MinValue),
            new PropertyEntry("Negative equity", "property", 120m, 150m, today, TimeOnly.MinValue),
            new CashEntry("Ignored", "cash", 99_999m, today, TimeOnly.MinValue)
        ]);

        var response = await host.PostForecastAsync(new ForecastRequest { Target = 371m, MonthlyContribution = 1m });
        var trend = response.RootElement.GetProperty("HistoricalTrend");

        Assert.Equal(370d, trend[0].GetProperty("Total").GetDouble(), 6);
        Assert.Equal(371d, trend[1].GetProperty("Total").GetDouble(), 6);
        Assert.Equal(1, response.RootElement.GetProperty("TrendTargetHitMonth").GetInt32());
    }

    [Fact]
    public async Task Forecast_adds_monthly_contributions_linearly_without_appreciation()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        await using var host = await ForecastHost.CreateAsync(
        [
            new InvestmentEntry("Fund", "investments", 100m, null, today.AddDays(-60), TimeOnly.MinValue),
            new InvestmentEntry("Fund", "investments", 121m, null, today, TimeOnly.MinValue)
        ]);

        var response = await host.PostForecastAsync(new ForecastRequest { Target = 160m, MonthlyContribution = 10m });
        var trend = response.RootElement.GetProperty("HistoricalTrend");

        Assert.Equal(121d, trend[0].GetProperty("Total").GetDouble(), 6);
        Assert.Equal(161d, trend[1].GetProperty("Total").GetDouble(), 6);
        Assert.Equal(4, response.RootElement.GetProperty("TrendTargetHitMonth").GetInt32());
    }

    private sealed class ForecastHost : IAsyncDisposable
    {
        private readonly WebApplication app;
        private readonly RouteEndpoint forecastEndpoint;
        private readonly RouteEndpoint aggregateEndpoint;
        private readonly RouteEndpoint calendarEndpoint;
        private readonly RouteEndpoint dashboardEndpoint;
        private readonly RouteEndpoint historyEndpoint;
        private readonly RouteEndpoint propertyCreateEndpoint;
        private readonly RouteEndpoint propertySnapshotEndpoint;
        private readonly RouteEndpoint propertyPatchEndpoint;

        private ForecastHost(WebApplication app)
        {
            this.app = app;
            var endpoints = ((IEndpointRouteBuilder)app).DataSources
                .SelectMany(source => source.Endpoints)
                .OfType<RouteEndpoint>()
                .ToArray();
            forecastEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/wealth/forecast");
            aggregateEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/wealth/{category}/aggregate");
            calendarEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/calendar");
            dashboardEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/dashboard");
            historyEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/history");
            propertyCreateEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/properties");
            propertySnapshotEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/properties/{id:guid}/entries");
            propertyPatchEndpoint = endpoints.Single(endpoint => endpoint.RoutePattern.RawText == "/api/properties/{id:guid}");
        }

        public WealthDbContext Db => app.Services.GetRequiredService<WealthDbContext>();

        public static async Task<ForecastHost> CreateAsync(
            IEnumerable<AssetValueEntry> entries,
            DateTimeOffset? now = null,
            IEnumerable<Asset>? assets = null,
            IEnumerable<IntegrationConnection>? connections = null)
        {
            var databaseRoot = new InMemoryDatabaseRoot();
            var builder = WebApplication.CreateBuilder();
            var dbOptions = new DbContextOptionsBuilder<WealthDbContext>()
                .UseInMemoryDatabase($"forecast-tests-{Guid.NewGuid()}", databaseRoot)
                .Options;
            builder.Services.AddSingleton(new WealthDbContext(dbOptions));
            builder.Services.AddWealthCaching();
            builder.Services.AddScoped<WealthReadModelService>();
            builder.Services.AddSingleton<TimeProvider>(new FixedTimeProvider(now ?? DateTimeOffset.UtcNow));
            builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = null);

            var app = builder.Build();
            app.MapWealthEndpoints();

            var db = app.Services.GetRequiredService<WealthDbContext>();
            var configuredConnectionKeys = connections?
                .Select(connection => connection.ProviderKey)
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
            if (assets is not null)
                db.Assets.AddRange(assets);
            if (connections is not null)
            {
                foreach (var connection in connections)
                {
                    if (!string.IsNullOrWhiteSpace(connection.ProviderKey))
                    {
                        var provider = new IntegrationProvider
                        {
                            Code = connection.ProviderKey,
                            DisplayName = connection.ProviderKey
                        };
                        connection.IntegrationProvider = provider;
                        connection.IntegrationProviderId = provider.Id;
                        db.IntegrationProviders.Add(provider);
                    }
                    db.IntegrationConnections.Add(connection);
                }
            }
            var entryList = entries.ToList();
            db.AssetValueEntries.AddRange(entryList);
            AssetCatalogService.EnsureDefaults(db);
            foreach (var asset in db.Assets.Local.ToList())
            {
                var kindCode = entryList
                    .Where(entry => entry.AssetId == asset.Id)
                    .Select(entry => AssetCatalogService.NormalizeAssetKindCode(entry.AssetKindCode))
                    .FirstOrDefault(code => !string.IsNullOrWhiteSpace(code))
                    ?? AssetKindCodes.Investments;
                var kind = await db.AssetKinds.FirstAsync(candidate => candidate.Code == kindCode);
                if (!asset.AssetKindAssignments.Any(assignment => assignment.AssetKindId == kind.Id))
                {
                    db.AssetKindAssignments.Add(new AssetKindAssignment
                    {
                        AssetId = asset.Id,
                        AssetKindId = kind.Id
                    });
                }
                if (kindCode == AssetKindCodes.Property)
                    await AssetCatalogService.EnsurePropertyAssetAsync(db, asset);
            }

            foreach (var entry in entryList.Where(entry => entry.AssetId == Guid.Empty))
            {
                if (entry is PropertyAssetValueEntry propertyEntry)
                {
                    var property = db.Assets.Local.FirstOrDefault(candidate =>
                        candidate.DisplayName.Equals(propertyEntry.Name, StringComparison.OrdinalIgnoreCase));
                    if (property is null)
                    {
                        property = new Asset { DisplayName = propertyEntry.Name };
                        db.Assets.Add(property);
                    }
                    propertyEntry.AssetId = property.Id;
                    await AssetCatalogService.EnsurePropertyAssetAsync(db, property);
                }
                else
                {
                    await AssetCatalogService.EnsureAssetForEntryAsync(db, entry);
                }

                await db.SaveChangesAsync();
            }

            await db.SaveChangesAsync();
            foreach (var entry in entryList.Where(entry =>
                         !string.IsNullOrWhiteSpace(entry.ProviderKey) &&
                         !string.IsNullOrWhiteSpace(entry.ExternalAssetId)))
            {
                var providerKey = entry.ProviderKey!;
                var provider = db.IntegrationProviders.Local.FirstOrDefault(candidate =>
                    candidate.Code.Equals(providerKey, StringComparison.OrdinalIgnoreCase));
                if (provider is null)
                {
                    provider = new IntegrationProvider { Code = providerKey, DisplayName = providerKey };
                    db.IntegrationProviders.Add(provider);
                }

                var connection = db.IntegrationConnections.Local.FirstOrDefault(candidate =>
                    candidate.IntegrationProviderId == provider.Id);
                if (connection is null)
                {
                    if (configuredConnectionKeys.Count > 0)
                    {
                        db.IntegrationProviders.Remove(provider);
                        continue;
                    }
                    connection = new IntegrationConnection
                    {
                        IntegrationProviderId = provider.Id,
                        IntegrationProvider = provider,
                        DisplayName = provider.DisplayName,
                        Enabled = true,
                        Status = IntegrationConnectionStatus.Active
                    };
                    db.IntegrationConnections.Add(connection);
                }

                var account = db.IntegrationAccounts.Local.FirstOrDefault(candidate =>
                    candidate.IntegrationConnectionId == connection.Id);
                if (account is null)
                {
                    account = new IntegrationAccount
                    {
                        IntegrationConnectionId = connection.Id,
                        IntegrationConnection = connection,
                        ExternalId = "legacy-account",
                        DisplayName = connection.DisplayName,
                        AccountType = "Investment",
                        Currency = "GBP",
                        Status = IntegrationAccountStatus.Allocated
                    };
                    db.IntegrationAccounts.Add(account);
                }

                var external = db.ExternalValues.Local.FirstOrDefault(candidate =>
                    candidate.IntegrationAccountId == account.Id &&
                    candidate.ExternalId == entry.ExternalAssetId);
                if (external is null)
                {
                    external = new ExternalValue
                    {
                        IntegrationAccountId = account.Id,
                        IntegrationAccount = account,
                        ExternalId = entry.ExternalAssetId!,
                        DisplayName = entry.Name,
                        Role = entry.ExternalAssetId!.EndsWith(":cash", StringComparison.OrdinalIgnoreCase)
                            ? ExternalValueRole.Undeployed
                            : ExternalValueRole.Deployed
                    };
                    db.ExternalValues.Add(external);
                }
                if (!db.ExternalValueAssetMappings.Local.Any(mapping => mapping.ExternalValueId == external.Id))
                {
                    db.ExternalValueAssetMappings.Add(new ExternalValueAssetMapping
                    {
                        ExternalValueId = external.Id,
                        ExternalValue = external,
                        AssetId = entry.AssetId
                    });
                }
                var source = new AssetValueEntrySource
                {
                    AssetValueEntryId = entry.Id,
                    AssetValueEntry = entry,
                    ExternalValueId = external.Id,
                    ExternalValue = external,
                    SourceKind = AssetValueEntrySourceKind.Integration
                };
                entry.SourceLink = source;
                db.AssetValueEntrySources.Add(source);
            }
            await db.SaveChangesAsync();
            return new ForecastHost(app);
        }

        public async Task<JsonDocument> PostForecastAsync(ForecastRequest request)
        {
            var context = new DefaultHttpContext { RequestServices = app.Services };
            context.Request.Method = HttpMethods.Post;
            context.Request.ContentType = "application/json";
            context.Request.Body = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(request));
            context.Request.ContentLength = context.Request.Body.Length;
            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Features.Set<IHttpRequestBodyDetectionFeature>(new RequestBodyDetectionFeature());

            await forecastEndpoint.RequestDelegate!(context);

            context.Response.Body.Position = 0;
            if (context.Response.StatusCode is < 200 or >= 300)
            {
                using var error = new StreamReader(context.Response.Body, leaveOpen: true);
                throw new InvalidOperationException($"{context.Response.StatusCode}: {await error.ReadToEndAsync()}");
            }
            return await JsonDocument.ParseAsync(context.Response.Body);
        }

        public async Task<JsonDocument> GetAggregateAsync(
            string category,
            string period,
            string? timeZone = null,
            DateOnly? asOfDate = null)
        {
            var context = new DefaultHttpContext { RequestServices = app.Services };
            context.Request.Method = HttpMethods.Get;
            context.Request.QueryString = QueryString.Create("period", period);
            if (timeZone is not null)
            {
                context.Request.QueryString = context.Request.QueryString.Add("timeZone", timeZone);
            }
            if (asOfDate is not null)
            {
                context.Request.QueryString = context.Request.QueryString.Add(
                    "asOfDate",
                    asOfDate.Value.ToString("yyyy-MM-dd"));
            }
            context.Request.RouteValues["category"] = category;
            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;

            await aggregateEndpoint.RequestDelegate!(context);

            context.Response.Body.Position = 0;
            if (context.Response.StatusCode is < 200 or >= 300)
            {
                using var error = new StreamReader(context.Response.Body, leaveOpen: true);
                throw new InvalidOperationException($"{context.Response.StatusCode}: {await error.ReadToEndAsync()}");
            }
            return await JsonDocument.ParseAsync(context.Response.Body);
        }

        public Task<JsonDocument> GetCalendarAsync(int year, int month) =>
            GetReadModelAsync(calendarEndpoint, new Dictionary<string, string>
            {
                ["year"] = year.ToString(),
                ["month"] = month.ToString()
            });

        public Task<JsonDocument> GetDashboardAsync(string period) =>
            GetReadModelAsync(dashboardEndpoint, new Dictionary<string, string>
            {
                ["period"] = period
            });

        public Task<JsonDocument> GetHistoryAsync(string period) =>
            GetReadModelAsync(historyEndpoint, new Dictionary<string, string>
            {
                ["period"] = period
            });

        private async Task<JsonDocument> GetReadModelAsync(
            RouteEndpoint endpoint,
            IReadOnlyDictionary<string, string> query)
        {
            var context = new DefaultHttpContext { RequestServices = app.Services };
            context.Request.Method = HttpMethods.Get;
            context.Request.QueryString = QueryString.Create(query);
            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;

            await endpoint.RequestDelegate!(context);

            context.Response.Body.Position = 0;
            if (context.Response.StatusCode is < 200 or >= 300)
            {
                using var error = new StreamReader(context.Response.Body, leaveOpen: true);
                throw new InvalidOperationException($"{context.Response.StatusCode}: {await error.ReadToEndAsync()}");
            }
            return await JsonDocument.ParseAsync(context.Response.Body);
        }

        public Task<EndpointResponse> PostPropertyAsync(PropertyCreateDto request) =>
            InvokeJsonAsync(propertyCreateEndpoint, HttpMethods.Post, request);

        public Task<EndpointResponse> PostPropertySnapshotAsync(Guid id, PropertySnapshotDto request) =>
            InvokeJsonAsync(propertySnapshotEndpoint, HttpMethods.Post, request, id);

        public Task<EndpointResponse> PatchPropertyAsync(Guid id, PropertyUpdateDto request) =>
            InvokeJsonAsync(propertyPatchEndpoint, HttpMethods.Patch, request, id);

        private async Task<EndpointResponse> InvokeJsonAsync(RouteEndpoint endpoint, string method, object body, Guid? id = null)
        {
            var context = new DefaultHttpContext { RequestServices = app.Services };
            context.Request.Method = method;
            context.Request.ContentType = "application/json";
            context.Request.Body = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(body));
            context.Request.ContentLength = context.Request.Body.Length;
            if (id.HasValue) context.Request.RouteValues["id"] = id.Value.ToString();
            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Features.Set<IHttpRequestBodyDetectionFeature>(new RequestBodyDetectionFeature());

            await endpoint.RequestDelegate!(context);

            context.Response.Body.Position = 0;
            JsonDocument? responseBody = context.Response.Body.Length == 0
                ? null
                : await JsonDocument.ParseAsync(context.Response.Body);
            return new EndpointResponse(context.Response.StatusCode, responseBody);
        }

        public async ValueTask DisposeAsync()
        {
            await app.DisposeAsync();
        }

        private sealed class RequestBodyDetectionFeature : IHttpRequestBodyDetectionFeature
        {
            public bool CanHaveBody => true;
        }

        public sealed record EndpointResponse(int StatusCode, JsonDocument? Body);
    }

    private static InvestmentEntry InvestmentAt(string name, decimal value, decimal investedCapital, DateTime timestamp) =>
        new(name, "investments", value, investedCapital, DateOnly.FromDateTime(timestamp), TimeOnly.FromDateTime(timestamp));

    private static DateTime Utc(int year, int month, int day, int hour, int minute) =>
        new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    private static DateTimeOffset ParseBucketStart(JsonElement point) =>
        DateTimeOffset.Parse(point.GetProperty("Time").GetString()!, System.Globalization.CultureInfo.InvariantCulture);

    private static void AssertHourlyTimeline(JsonElement[] data, string timeZone, DateTime firstLocalHour, DateTime lastLocalHour)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var localHours = data
            .Select(point => TimeZoneInfo.ConvertTime(ParseBucketStart(point), zone).DateTime)
            .ToArray();

        Assert.Equal(firstLocalHour, localHours[0]);
        Assert.Equal(lastLocalHour, localHours[^1]);
        Assert.All(localHours, hour => Assert.Equal(DateTimeKind.Unspecified, hour.Kind));
        Assert.Equal(data.Select(ParseBucketStart).OrderBy(timestamp => timestamp), data.Select(ParseBucketStart));
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
