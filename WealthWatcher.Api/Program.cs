using Microsoft.AspNetCore.DataProtection;
using System.Runtime.CompilerServices;
using Serilog;
using WealthWatcher.Api;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Integrations;
using WealthWatcher.Api.Integrations.Webhooks;
using WealthWatcher.Api.Services;

[assembly: InternalsVisibleTo("WealthWatcher.Api.Tests")]

var builder = WebApplication.CreateBuilder(args);

var loggerConfiguration = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "WealthWatcher.Api")
    .WriteTo.Console();

Log.Logger = loggerConfiguration.CreateLogger();

builder.Host.UseSerilog();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddWealthData(builder.Configuration, builder.Environment);
builder.Services.AddWealthCaching();

builder.Services.AddHttpClient();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = null; // Keep responses aligned with the current UI contract
});

var credentialKeyPath = builder.Configuration["CredentialKeyPath"]
    ?? Path.Combine(AppContext.BaseDirectory, "config", "keys");
Directory.CreateDirectory(credentialKeyPath);
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(credentialKeyPath));

builder.Services.AddHttpClient<Trading212IntegrationAdapter>();
builder.Services.AddTransient<IIntegrationAdapter>(sp =>
    sp.GetRequiredService<Trading212IntegrationAdapter>());
builder.Services.AddHttpClient<SnaptradeIntegrationAdapter>();
builder.Services.AddTransient<IIntegrationAdapter>(sp =>
    sp.GetRequiredService<SnaptradeIntegrationAdapter>());
builder.Services.AddSingleton<IIntegrationCredentialProtector, IntegrationCredentialProtector>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IProviderRateLimiter, ProviderRateLimiter>();
builder.Services.AddSingleton<IntegrationRegistry>();
builder.Services.AddScoped<IntegrationSettingsService>();
builder.Services.AddScoped<IntegrationService>();
builder.Services.AddScoped<WealthReadModelService>();

builder.Services.AddSingleton<WebhookRelayStatus>();
builder.Services.AddSingleton<WebhookRelayControl>();
builder.Services.AddSingleton<WebhookRelayTestTracker>();
builder.Services.AddSingleton<IWebhookConnectionResolver, DefaultWebhookConnectionResolver>();
builder.Services.AddSingleton<IWebhookConnectionResolver, SnaptradeWebhookConnectionResolver>();
builder.Services.AddSingleton<IWebhookDispatcher, WebhookDispatcher>();
builder.Services.AddScoped<WebhookRelaySettingsService>();
builder.Services.AddScoped<WebhookRelayTestService>();
builder.Services.AddOptions<WebhookRelayOptions>()
    .BindConfiguration(WebhookRelayOptions.SectionName)
    .Validate(options => options.IsValid(out _),
        "Webhook relay configuration is incomplete or uses an invalid WebSocket URL.")
    .ValidateOnStart();

if (builder.Configuration.GetValue<bool>($"{WebhookRelayOptions.SectionName}:Enabled"))
    builder.Services.AddHostedService<WebhookRelayWorker>();

builder.Services.AddHostedService<IntegrationSyncWorker>();

builder.Services.AddCors(options =>
{
    var allowedOrigins = CorsConfiguration.GetAllowedOrigins(builder.Configuration);
    options.AddPolicy("Ui",
        policyBuilder =>
        {
            policyBuilder.AllowAnyMethod().AllowAnyHeader();
            if (allowedOrigins.Count > 0)
            {
                policyBuilder.WithOrigins(allowedOrigins.ToArray());
            }
        });
});

var app = builder.Build();

app.InitializeDatabase();

using (var relayScope = app.Services.CreateScope())
{
    var relayControl = relayScope.ServiceProvider.GetRequiredService<WebhookRelayControl>();
    var db = relayScope.ServiceProvider.GetRequiredService<WealthDbContext>();
    relayControl.LoadPersistedState(db);
}

app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});

app.UseCors("Ui");

app.UseSerilogRequestLogging();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapWealthEndpoints();
app.MapIntegrationEndpoints();
app.MapGet("/health", HealthCheckAsync);
app.MapGet("/api/health", HealthCheckAsync);

app.Run();

async Task<IResult> HealthCheckAsync(WealthDbContext db, CancellationToken cancellationToken)
{
    try
    {
        var canConnect = await db.Database.CanConnectAsync(cancellationToken);
        return canConnect
            ? Results.Ok(new { Status = "ok" })
            : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
    catch (Exception exception)
    {
        app.Logger.LogError(exception, "Health check failed.");
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
}

namespace WealthWatcher.Api
{
    internal static class CorsConfiguration
    {
        internal const string AllowedOriginsKey = "Cors:AllowedOrigins";

        private static readonly string[] DefaultOrigins =
        [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8182",
            "http://127.0.0.1:8182"
        ];

        internal static IReadOnlyList<string> GetAllowedOrigins(IConfiguration configuration)
        {
            var section = configuration.GetSection(AllowedOriginsKey);
            if (!section.Exists())
                return DefaultOrigins;

            return section.GetChildren()
                .Select(child => child.Value?.Trim())
                .Where(origin => !string.IsNullOrWhiteSpace(origin))
                .Select(origin => origin!)
                .Where(IsValidOrigin)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        private static bool IsValidOrigin(string? origin)
        {
            return Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
                string.IsNullOrEmpty(uri.AbsolutePath.TrimEnd('/')) &&
                string.IsNullOrEmpty(uri.Query) &&
                string.IsNullOrEmpty(uri.Fragment) &&
                string.IsNullOrEmpty(uri.UserInfo);
        }
    }
}
