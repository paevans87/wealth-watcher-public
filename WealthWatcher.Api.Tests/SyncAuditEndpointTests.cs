using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Models;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class SyncAuditEndpointTests
{
    [Fact]
    public async Task Audits_endpoint_maps_sync_runs_to_the_audit_view_contract()
    {
        var builder = WebApplication.CreateBuilder();
        var dbOptions = new DbContextOptionsBuilder<WealthDbContext>()
            .UseInMemoryDatabase($"sync-audit-endpoint-{Guid.NewGuid():N}")
            .Options;
        builder.Services.AddSingleton(new WealthDbContext(dbOptions));
        builder.Services.AddWealthCaching();
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.ConfigureHttpJsonOptions(options =>
            options.SerializerOptions.PropertyNamingPolicy = null);

        await using var app = builder.Build();
        app.MapWealthEndpoints();

        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
            db.SyncRuns.AddRange(
                new SyncRun
                {
                    ConnectionDisplayNameSnapshot = "Older connection",
                    StartTime = new DateTimeOffset(2026, 8, 6, 8, 0, 0, TimeSpan.Zero),
                    EndTime = new DateTimeOffset(2026, 8, 6, 8, 0, 2, TimeSpan.Zero),
                    Status = SyncRunStatus.Success,
                    RecordsAdded = 4,
                    LogMessage = "Older sync completed."
                },
                new SyncRun
                {
                    ConnectionDisplayNameSnapshot = "ISA",
                    StartTime = new DateTimeOffset(2026, 8, 6, 9, 0, 0, TimeSpan.Zero),
                    EndTime = new DateTimeOffset(2026, 8, 6, 9, 0, 3, TimeSpan.Zero),
                    Status = SyncRunStatus.Failed,
                    RecordsAdded = 0,
                    LogMessage = "Credentials expired."
                });
            await db.SaveChangesAsync();
        }

        var endpoint = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(candidate => candidate.RoutePattern.RawText == "/api/audits");
        var context = new DefaultHttpContext { RequestServices = app.Services };
        context.Request.Method = HttpMethods.Get;
        context.Request.QueryString = new QueryString("?page=1&pageSize=10");
        context.Response.Body = new MemoryStream();

        await endpoint.RequestDelegate!(context);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var response = await JsonDocument.ParseAsync(context.Response.Body);
        var root = response.RootElement;
        Assert.Equal(2, root.GetProperty("Total").GetInt32());

        var audits = root.GetProperty("Audits").EnumerateArray().ToArray();
        Assert.Equal(2, audits.Length);

        var latest = audits[0];
        Assert.Equal("ISA", latest.GetProperty("ProviderName").GetString());
        Assert.Equal("Failed", latest.GetProperty("Status").GetString());
        Assert.Equal(0, latest.GetProperty("RecordsAdded").GetInt32());
        Assert.Equal("Credentials expired.", latest.GetProperty("LogMessage").GetString());
        Assert.False(latest.TryGetProperty("ConnectionDisplayNameSnapshot", out _));

        var older = audits[1];
        Assert.Equal("Older connection", older.GetProperty("ProviderName").GetString());
        Assert.Equal("Success", older.GetProperty("Status").GetString());
    }
}
