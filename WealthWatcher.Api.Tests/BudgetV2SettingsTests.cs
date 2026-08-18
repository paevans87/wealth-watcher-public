using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Models;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class BudgetV2SettingsTests
{
    [Fact]
    public async Task Get_settings_falls_back_to_legacy_lines_with_update_metadata()
    {
        var historicId = Guid.NewGuid();
        await using var host = await SettingsHost.CreateAsync();
        host.Db.BudgetLines.Add(new BudgetLine
        {
            Id = historicId,
            Category = BudgetLineCategory.Bills,
            Name = "Mortgage",
            Amount = 1_450m,
            Cadence = BudgetCadence.Monthly
        });
        await host.Db.SaveChangesAsync();

        var response = await host.GetAsync();

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        var budget = ParseBudget(response);
        Assert.Equal(1, budget.GetProperty("version").GetInt32());
        Assert.True(budget.GetProperty("needsUpdate").GetBoolean());
        Assert.Equal(historicId, budget.GetProperty("bills")[0].GetProperty("id").GetGuid());
        Assert.False(budget.TryGetProperty("groups", out _));
        Assert.Null(host.Db.AppPreferences.SingleOrDefault()?.BudgetJson);
    }

    [Fact]
    public async Task V2_budget_round_trips_groups_categories_and_legacy_arrays()
    {
        var incomeId = Guid.NewGuid();
        var mortgageId = Guid.NewGuid();
        var mortgageAsset = new Asset { DisplayName = "Home" };
        await using var host = await SettingsHost.CreateAsync(assets: [mortgageAsset]);

        var response = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group(
                    "income",
                    "Income",
                    "income",
                    true,
                    Item(incomeId, "Salary", 6_500m, "monthly")),
                Group(
                    "housing",
                    "Bills",
                    "custom",
                    false,
                    Item(mortgageId, "Mortgage", 1_450m, "monthly", mortgageAsset.Id, "Accommodation"),
                    role: "bills",
                    color: "#0ea5e9"))
        });

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        Assert.NotNull(host.Db.AppPreferences.Single().BudgetJson);

        var lines = await host.Db.BudgetLines
            .Include(line => line.AssetMappings)
            .OrderBy(line => line.Id)
            .ToListAsync();
        Assert.Equal(2, lines.Count);
        Assert.Contains(lines, line => line.Id == incomeId && line.Category == BudgetLineCategory.Income);
        var mortgageLine = Assert.Single(lines, line => line.Id == mortgageId);
        Assert.Equal(BudgetLineCategory.Bills, mortgageLine.Category);
        Assert.Equal(mortgageAsset.Id, mortgageLine.AssetMappings.Single().AssetId);

        var getResponse = await host.GetAsync();
        var budget = ParseBudget(getResponse);
        Assert.Equal(2, budget.GetProperty("version").GetInt32());
        Assert.False(budget.GetProperty("needsUpdate").GetBoolean());
        var groups = budget.GetProperty("groups");
        Assert.Equal(2, groups.GetArrayLength());
        Assert.Equal("Income", groups[0].GetProperty("name").GetString());
        var bills = groups[1];
        Assert.Equal("Bills", bills.GetProperty("name").GetString());
        Assert.Equal("custom", bills.GetProperty("kind").GetString());
        Assert.Equal("bills", bills.GetProperty("role").GetString());
        Assert.Equal("#0ea5e9", bills.GetProperty("color").GetString());
        Assert.Equal(
            "Accommodation",
            bills.GetProperty("items")[0].GetProperty("category").GetString());
        Assert.Equal(1_450d, budget.GetProperty("bills")[0].GetProperty("amount").GetDouble());
    }

    [Fact]
    public async Task Invalid_v2_budget_is_rejected_before_any_budget_state_changes()
    {
        var incomeId = Guid.NewGuid();
        var billId = Guid.NewGuid();
        await using var host = await SettingsHost.CreateAsync();
        var valid = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("income", "Income", "income", true, Item(incomeId, "Salary", 6_500m, "monthly")),
                Group("bills", "Bills", "custom", false, Item(billId, "Mortgage", 1_450m, "monthly"), role: "bills"))
        });
        Assert.Equal(StatusCodes.Status200OK, valid.StatusCode);
        var beforeJson = host.Db.AppPreferences.Single().BudgetJson;
        var beforeLines = await host.Db.BudgetLines
            .AsNoTracking()
            .OrderBy(line => line.Id)
            .Select(line => new { line.Id, line.Name, line.Amount, line.Category })
            .ToListAsync();

        var invalid = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("income", "Income", "income", true, Item(incomeId, "Salary", 7_000m, "monthly")),
                Group(
                    "bills",
                    "Bills",
                    "custom",
                    false,
                    Item(billId, "Mortgage", -1m, "monthly"),
                    role: "bills"))
        });

        Assert.Equal(StatusCodes.Status400BadRequest, invalid.StatusCode);
        Assert.Equal(beforeJson, host.Db.AppPreferences.Single().BudgetJson);
        var afterLines = await host.Db.BudgetLines
            .AsNoTracking()
            .OrderBy(line => line.Id)
            .Select(line => new { line.Id, line.Name, line.Amount, line.Category })
            .ToListAsync();
        Assert.Equal(beforeLines, afterLines);
    }

    [Fact]
    public async Task V2_budget_requires_one_immutable_built_in_income_group()
    {
        await using var host = await SettingsHost.CreateAsync();

        var missingIncome = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("bills", "Bills", "custom", false, Item(Guid.NewGuid(), "Mortgage", 1_450m, "monthly"), role: "bills"))
        });

        Assert.Equal(StatusCodes.Status400BadRequest, missingIncome.StatusCode);
        Assert.Empty(host.Db.BudgetLines);
        Assert.Empty(host.Db.AppPreferences);

        var incomeId = Guid.NewGuid();
        var valid = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("income", "Income", "income", true, Item(incomeId, "Salary", 6_500m, "monthly")))
        });
        Assert.Equal(StatusCodes.Status200OK, valid.StatusCode);
        var beforeJson = host.Db.AppPreferences.Single().BudgetJson;

        var renamedIncome = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("income", "Earnings", "income", true, Item(incomeId, "Salary", 6_500m, "monthly")))
        });

        Assert.Equal(StatusCodes.Status400BadRequest, renamedIncome.StatusCode);
        Assert.Equal(beforeJson, host.Db.AppPreferences.Single().BudgetJson);
    }

    [Fact]
    public async Task V2_budget_preserves_existing_asset_mapping_when_asset_id_is_omitted()
    {
        var lineId = Guid.NewGuid();
        var asset = new Asset { DisplayName = "Emergency fund" };
        await using var host = await SettingsHost.CreateAsync(assets: [asset]);
        host.Db.BudgetLines.Add(new BudgetLine
        {
            Id = lineId,
            Category = BudgetLineCategory.Savings,
            Name = "Emergency fund",
            Amount = 450m,
            Cadence = BudgetCadence.Monthly
        });
        host.Db.BudgetLineAssetMappings.Add(new BudgetLineAssetMapping
        {
            BudgetLineId = lineId,
            AssetId = asset.Id
        });
        await host.Db.SaveChangesAsync();

        var response = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("income", "Income", "income", true, Item(Guid.NewGuid(), "Salary", 6_500m, "monthly")),
                Group(
                    "savings",
                    "Savings",
                    "custom",
                    false,
                    ItemWithoutAssetId(lineId, "Emergency fund", 500m, "monthly", "Retirement"),
                    role: "savings"))
        });

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        var saved = await host.Db.BudgetLines
            .Include(line => line.AssetMappings)
            .SingleAsync(line => line.Id == lineId);
        Assert.Equal(asset.Id, saved.AssetMappings.Single().AssetId);
        Assert.Equal(500m, saved.Amount);
    }

    [Fact]
    public async Task Legacy_budget_write_cannot_silently_clear_a_saved_v2_document()
    {
        await using var host = await SettingsHost.CreateAsync();
        var incomeId = Guid.NewGuid();
        var v2 = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = V2Document(
                Group("income", "Income", "income", true, Item(incomeId, "Salary", 6_500m, "monthly")))
        });
        Assert.Equal(StatusCodes.Status200OK, v2.StatusCode);
        var beforeJson = host.Db.AppPreferences.Single().BudgetJson;

        var legacy = await host.PostAsync(new Dictionary<string, string?>
        {
            ["wealthWatcherBudgetSettings"] = JsonSerializer.Serialize(new
            {
                income = new[] { Item(incomeId, "Salary", 6_500m, "monthly") },
                bills = Array.Empty<object>(),
                savings = Array.Empty<object>(),
                spend = Array.Empty<object>()
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web))
        });

        Assert.Equal(StatusCodes.Status409Conflict, legacy.StatusCode);
        Assert.Equal(beforeJson, host.Db.AppPreferences.Single().BudgetJson);
    }

    private static JsonElement ParseBudget(EndpointResponse response)
    {
        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        return response.Body!.RootElement
            .GetProperty("wealthWatcherBudgetSettings").GetString() is { } json
            ? JsonDocument.Parse(json).RootElement.Clone()
            : throw new Xunit.Sdk.XunitException("The settings response did not contain budget JSON.");
    }

    private static string V2Document(params object[] groups)
        => JsonSerializer.Serialize(
            new { version = 2, needsUpdate = false, groups },
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

    private static object Group(
        string id,
        string name,
        string kind,
        bool builtIn,
        object item,
        object? item2 = null,
        string? role = null,
        string? color = null)
        => new
        {
            id,
            name,
            kind,
            role,
            builtIn,
            color,
            items = item2 is null ? new[] { item } : new[] { item, item2 }
        };

    private static object Item(
        Guid id,
        string name,
        decimal amount,
        string cadence,
        Guid? assetId = null,
        string? category = null)
        => new { id = id.ToString("D"), name, amount, cadence, assetId, category };

    private static object ItemWithoutAssetId(
        Guid id,
        string name,
        decimal amount,
        string cadence,
        string category)
        => new { id = id.ToString("D"), name, amount, cadence, category };

    private sealed class SettingsHost : IAsyncDisposable
    {
        private readonly WebApplication app;
        private readonly RouteEndpoint getEndpoint;
        private readonly RouteEndpoint postEndpoint;

        private SettingsHost(WebApplication app)
        {
            this.app = app;
            var endpoints = ((IEndpointRouteBuilder)app).DataSources
                .SelectMany(source => source.Endpoints)
                .OfType<RouteEndpoint>()
                .Where(endpoint => endpoint.RoutePattern.RawText == "/api/settings")
                .ToArray();
            getEndpoint = endpoints.Single(endpoint =>
                endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(HttpMethods.Get) == true);
            postEndpoint = endpoints.Single(endpoint =>
                endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(HttpMethods.Post) == true);
        }

        public WealthDbContext Db => app.Services.GetRequiredService<WealthDbContext>();

        public static async Task<SettingsHost> CreateAsync(IEnumerable<Asset>? assets = null)
        {
            var databaseRoot = new InMemoryDatabaseRoot();
            var builder = WebApplication.CreateBuilder();
            var dbOptions = new DbContextOptionsBuilder<WealthDbContext>()
                .UseInMemoryDatabase($"budget-v2-settings-tests-{Guid.NewGuid()}", databaseRoot)
                .Options;
            builder.Services.AddSingleton(new WealthDbContext(dbOptions));
            builder.Services.AddWealthCaching();
            builder.Services.AddSingleton(TimeProvider.System);
            builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = null);

            var app = builder.Build();
            app.MapWealthEndpoints();
            if (assets is not null)
            {
                var db = app.Services.GetRequiredService<WealthDbContext>();
                db.Assets.AddRange(assets);
                await db.SaveChangesAsync();
            }

            return new SettingsHost(app);
        }

        public Task<EndpointResponse> GetAsync() => InvokeAsync(getEndpoint, HttpMethods.Get);

        public Task<EndpointResponse> PostAsync(Dictionary<string, string?> settings)
            => InvokeAsync(postEndpoint, HttpMethods.Post, JsonSerializer.Serialize(settings));

        private async Task<EndpointResponse> InvokeAsync(RouteEndpoint endpoint, string method, string? body = null)
        {
            var context = new DefaultHttpContext { RequestServices = app.Services };
            context.Request.Method = method;
            if (body is not null)
            {
                context.Request.ContentType = "application/json";
                context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
                context.Request.ContentLength = context.Request.Body.Length;
                context.Features.Set<IHttpRequestBodyDetectionFeature>(new RequestBodyDetectionFeature());
            }

            context.Response.Body = new MemoryStream();
            context.Response.StatusCode = StatusCodes.Status200OK;
            await endpoint.RequestDelegate!(context);

            context.Response.Body.Position = 0;
            var rawBody = await new StreamReader(context.Response.Body, leaveOpen: true).ReadToEndAsync();
            JsonDocument? responseBody = string.IsNullOrWhiteSpace(rawBody)
                ? null
                : JsonDocument.Parse(rawBody);
            return new EndpointResponse(context.Response.StatusCode, responseBody, rawBody);
        }

        private sealed class RequestBodyDetectionFeature : IHttpRequestBodyDetectionFeature
        {
            public bool CanHaveBody => true;
        }

        public async ValueTask DisposeAsync() => await app.DisposeAsync();
    }

    private sealed record EndpointResponse(int StatusCode, JsonDocument? Body, string RawBody);
}
