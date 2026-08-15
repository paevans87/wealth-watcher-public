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

public sealed class MilestoneSettingsTests
{
    [Fact]
    public async Task Settings_round_trip_milestones_and_reject_invalid_writes_atomically()
    {
        await using var host = await SettingsHost.CreateAsync();

        var initial = await host.GetAsync();
        Assert.Equal(StatusCodes.Status200OK, initial.StatusCode);
        Assert.Equal(MilestoneSettingsPolicy.DefaultJson, initial.Body!.RootElement
            .GetProperty("wealthWatcherMilestoneSettings")
            .GetString());

        var valid = await host.PostAsync(new Dictionary<string, string>
        {
            ["wealthWatcherMilestoneSettings"] = "{\"targets\":[600000,500000]}"
        });
        Assert.Equal(StatusCodes.Status200OK, valid.StatusCode);
        Assert.Equal(string.Empty, valid.RawBody);
        Assert.Equal("{\"targets\":[500000,600000]}",
            (await host.GetAsync()).Body!.RootElement.GetProperty("wealthWatcherMilestoneSettings").GetString());

        var invalid = await host.PostAsync(new Dictionary<string, string>
        {
            ["wealthWatcherMilestoneSettings"] = "{\"targets\":[500000,500000]}"
        });
        Assert.Equal(StatusCodes.Status400BadRequest, invalid.StatusCode);
        Assert.Contains("unique", invalid.RawBody, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("{\"targets\":[500000,600000]}", host.Db.AppPreferences.Single().MilestoneJson);
    }

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
            getEndpoint = endpoints.Single(endpoint => endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("GET") == true);
            postEndpoint = endpoints.Single(endpoint => endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") == true);
        }

        public WealthDbContext Db => app.Services.GetRequiredService<WealthDbContext>();

        public static async Task<SettingsHost> CreateAsync()
        {
            var databaseRoot = new InMemoryDatabaseRoot();
            var builder = WebApplication.CreateBuilder();
            var dbOptions = new DbContextOptionsBuilder<WealthDbContext>()
                .UseInMemoryDatabase($"milestone-settings-tests-{Guid.NewGuid()}", databaseRoot)
                .Options;
            builder.Services.AddSingleton(new WealthDbContext(dbOptions));
            builder.Services.AddWealthCaching();
            builder.Services.AddSingleton(TimeProvider.System);
            builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = null);

            var app = builder.Build();
            app.MapWealthEndpoints();
            await Task.CompletedTask;
            return new SettingsHost(app);
        }

        public async Task<EndpointResponse> GetAsync() => await InvokeAsync(getEndpoint, HttpMethods.Get, null);

        public async Task<EndpointResponse> PostAsync(Dictionary<string, string> settings) =>
            await InvokeAsync(postEndpoint, HttpMethods.Post, JsonSerializer.Serialize(settings));

        private async Task<EndpointResponse> InvokeAsync(RouteEndpoint endpoint, string method, string? body)
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
