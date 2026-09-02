using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;
using WealthWatcher.WebhookRelay;

var builder = WebApplication.CreateBuilder(args);

var configuredMaxBodySize = builder.Configuration.GetValue<long?>(
    $"{RelayOptions.SectionName}:MaxWebhookBodyBytes") ?? 1_048_576;
builder.WebHost.ConfigureKestrel(serverOptions =>
{
    serverOptions.Limits.MaxRequestBodySize = configuredMaxBodySize;
});

builder.Services.AddOptions<RelayOptions>()
    .BindConfiguration(RelayOptions.SectionName)
    .Validate(options => options.IsValid(out _),
        "Relay configuration is invalid.")
    .ValidateOnStart();
builder.Services.AddRateLimiter(rateLimiterOptions =>
{
    rateLimiterOptions.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    rateLimiterOptions.AddPolicy("webhooks", context =>
    {
        var provider = context.Request.RouteValues["provider"]?.ToString() ?? "unknown";
        var source = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var partition = $"{provider}:{source}";
        return RateLimitPartition.GetFixedWindowLimiter(
            partition,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            });
    });
});
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
builder.Services.AddSingleton<RelayInstallationRegistry>();
builder.Services.AddSingleton<RelayConnectionManager>();

var relayConnectionString = builder.Configuration.GetConnectionString("RelayDatabase");
if (string.IsNullOrWhiteSpace(relayConnectionString))
{
    var databasePath = builder.Configuration[$"{RelayOptions.SectionName}:DatabasePath"]
                       ?? "/data/relay.db";
    relayConnectionString = $"Data Source={databasePath}";
}

builder.Services.AddSingleton<IRelayMessageStore>(
    new RelayMessageStore(relayConnectionString));
builder.Services.AddSingleton<IWebhookProviderHandler, SnapTradeWebhookProviderHandler>();
builder.Services.AddHostedService<RelayDeliveryWorker>();

var app = builder.Build();
var messageStore = app.Services.GetRequiredService<IRelayMessageStore>();
await messageStore.InitializeAsync();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30)
});
app.UseRateLimiter();

app.MapGet("/health", async (
    IRelayMessageStore store,
    CancellationToken cancellationToken) =>
{
    var available = await store.CanConnectAsync(cancellationToken);
    return available
        ? Results.Ok(new { Status = "ok" })
        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
});

app.MapGet("/ready", async (
    IRelayMessageStore store,
    RelayInstallationRegistry installations,
    CancellationToken cancellationToken) =>
{
    var available = await store.CanConnectAsync(cancellationToken);
    // A relay may intentionally start before its first installation is added;
    // readiness therefore verifies process/storage health, not client presence.
    _ = installations;
    return available
        ? Results.Ok(new { Status = "ready" })
        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
});

app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    var installationId = context.Request.Headers["X-WealthWatcher-Installation"].FirstOrDefault();
    var authorization = context.Request.Headers["Authorization"].FirstOrDefault();
    var token = authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
        ? authorization["Bearer ".Length..].Trim()
        : null;
    var installationRegistry = context.RequestServices.GetRequiredService<RelayInstallationRegistry>();
    if (string.IsNullOrWhiteSpace(installationId) ||
        !installationRegistry.Authenticate(installationId, token))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    var socket = await context.WebSockets.AcceptWebSocketAsync();
    var manager = context.RequestServices.GetRequiredService<RelayConnectionManager>();
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
        .CreateLogger("WealthWatcher.WebhookRelay.WebSocket");
    var connection = await manager.RegisterAsync(installationId, socket);
    try
    {
        await connection.SendControlAsync("hello", context.RequestAborted);
        await connection.RunReceiveLoopAsync(logger, context.RequestAborted);
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
    }
    catch (WebSocketException exception)
    {
        logger.LogInformation(exception, "Wealth Watcher installation {InstallationId} disconnected.", installationId);
    }
    finally
    {
        manager.Remove(connection);
        await connection.DisposeAsync();
    }
});

app.MapPost("/test/{installationId}/{testId}", async (
    string installationId,
    string testId,
    RelayInstallationRegistry installations,
    IRelayMessageStore store,
    TimeProvider timeProvider,
    HttpRequest request,
    CancellationToken cancellationToken) =>
{
    if (!installations.IsKnown(installationId))
        return Results.NotFound(new { Error = "Webhook installation is not configured." });

    var authorization = request.Headers["Authorization"].FirstOrDefault();
    var token = authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
        ? authorization["Bearer ".Length..].Trim()
        : null;
    if (!installations.Authenticate(installationId, token))
        return Results.Unauthorized();
    if (!Guid.TryParseExact(testId, "N", out _))
        return Results.BadRequest(new { Error = "The relay test id is invalid." });

    var receivedAt = timeProvider.GetUtcNow();
    var message = new RelayMessage
    {
        MessageId = $"relay-test-{testId}",
        InstallationId = installationId,
        Provider = "wealth-watcher",
        EventType = "relay_test",
        ReceivedAt = receivedAt,
        Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["X-WealthWatcher-Relay-Test"] = "true"
        },
        PayloadJson = JsonSerializer.Serialize(new { testId, requestedAt = receivedAt })
    };
    var enqueue = await store.EnqueueAsync(message, cancellationToken);
    return Results.Accepted(
        $"/test/{installationId}/{testId}",
        new { Id = message.MessageId, Queued = true, Duplicate = !enqueue.Added });
});

app.MapPost("/webhooks/{provider}", async (
    string provider,
    HttpRequest request,
    RelayInstallationRegistry installations,
    IEnumerable<IWebhookProviderHandler> handlers,
    IRelayMessageStore store,
    IOptions<RelayOptions> options,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    if (!installations.TryGetSingleInstallationId(out var installationId))
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    var handler = handlers.FirstOrDefault(candidate =>
        string.Equals(candidate.ProviderKey, provider, StringComparison.OrdinalIgnoreCase));
    if (handler is null)
        return Results.NotFound(new { Error = "Webhook provider is not configured." });

    byte[] body;
    try
    {
        body = await ReadBodyAsync(request.Body, options.Value.MaxWebhookBodyBytes, cancellationToken);
    }
    catch (PayloadTooLargeException)
    {
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    var headers = request.Headers
        .Where(header => header.Value.Count > 0)
        .ToDictionary(
            header => header.Key,
            header => header.Value.ToString(),
            StringComparer.OrdinalIgnoreCase);
    var result = await handler.HandleAsync(
        new ProviderWebhookRequest(installationId, provider, body, headers),
        cancellationToken);
    if (!result.Accepted)
    {
        loggerFactory.CreateLogger("WealthWatcher.WebhookRelay.Webhook")
            .LogWarning(
                "Provider webhook rejected for {InstallationId} {Provider} with status {StatusCode}.",
                installationId,
                provider,
                result.RejectionStatusCode);
        return Results.Json(
            new { Error = result.RejectionMessage },
            statusCode: result.RejectionStatusCode);
    }

    var message = new RelayMessage
    {
        MessageId = result.MessageId!,
        InstallationId = installationId,
        Provider = provider.Trim().ToLowerInvariant(),
        EventType = result.EventType,
        ReceivedAt = result.ReceivedAt,
        Headers = result.ForwardedHeaders,
        PayloadJson = result.Payload.GetRawText()
    };
    var enqueue = await store.EnqueueAsync(message, cancellationToken);
    loggerFactory.CreateLogger("WealthWatcher.WebhookRelay.Webhook")
        .LogInformation(
            "Provider webhook queued for {InstallationId} {Provider} {MessageId} (duplicate: {Duplicate}).",
            installationId,
            provider,
            message.MessageId,
            !enqueue.Added);

    return Results.Accepted(
        $"/webhooks/{provider}",
        new { Id = message.MessageId, Queued = true, Duplicate = !enqueue.Added });
}).RequireRateLimiting("webhooks");

app.Run();

static async Task<byte[]> ReadBodyAsync(
    Stream body,
    long maximumBytes,
    CancellationToken cancellationToken)
{
    var buffer = new byte[81920];
    await using var output = new MemoryStream();
    while (true)
    {
        var read = await body.ReadAsync(buffer, cancellationToken);
        if (read == 0)
            break;
        if (output.Length + read > maximumBytes)
            throw new PayloadTooLargeException();
        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
    }

    return output.ToArray();
}

internal sealed class PayloadTooLargeException : Exception
{
}
