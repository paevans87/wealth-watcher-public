using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;

namespace WealthWatcher.Api.Integrations.Webhooks;

public sealed class WebhookDispatcher(
    IServiceScopeFactory scopeFactory,
    IntegrationRegistry registry,
    IEnumerable<IWebhookConnectionResolver> resolvers,
    ILogger<WebhookDispatcher> logger) : IWebhookDispatcher
{
    private readonly IReadOnlyList<IWebhookConnectionResolver> connectionResolvers = resolvers.ToList();
    private readonly ConcurrentDictionary<string, Lazy<Task<WebhookDispatchResult>>> inFlightEvents = new(
        StringComparer.OrdinalIgnoreCase);

    public Task<WebhookDispatchResult> DispatchAsync(
        WebhookEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        var eventKey = $"{envelope.Provider}:{envelope.Id}";
        var lazyDispatch = inFlightEvents.GetOrAdd(
            eventKey,
            _ => new Lazy<Task<WebhookDispatchResult>>(
                () => DispatchCoreAsync(envelope, cancellationToken),
                LazyThreadSafetyMode.ExecutionAndPublication));
        return AwaitAndReleaseAsync(eventKey, lazyDispatch, lazyDispatch.Value);
    }

    private async Task<WebhookDispatchResult> AwaitAndReleaseAsync(
        string eventKey,
        Lazy<Task<WebhookDispatchResult>> lazyDispatch,
        Task<WebhookDispatchResult> dispatch)
    {
        try
        {
            return await dispatch;
        }
        finally
        {
            inFlightEvents.TryRemove(
                new KeyValuePair<string, Lazy<Task<WebhookDispatchResult>>>(
                    eventKey,
                    lazyDispatch));
        }
    }

    private async Task<WebhookDispatchResult> DispatchCoreAsync(
        WebhookEnvelope envelope,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(envelope.Id) || string.IsNullOrWhiteSpace(envelope.Provider))
        {
            return Ignored("The relay event did not identify a provider and event.");
        }

        var adapter = registry.All.FirstOrDefault(candidate =>
            string.Equals(candidate.Key, envelope.Provider, StringComparison.OrdinalIgnoreCase));
        if (adapter is null || !adapter.Descriptor.SupportsWebhooks)
        {
            return Ignored("The provider is not configured for webhook-driven updates.");
        }

        var resolver = connectionResolvers
            .Where(candidate => candidate.CanResolve(envelope.Provider))
            .OrderByDescending(candidate => candidate.Priority)
            .FirstOrDefault();
        if (resolver is null)
            return Ignored("No webhook connection resolver is configured for the provider.");

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        var connectionIds = await resolver.ResolveAsync(envelope, db, cancellationToken);
        if (connectionIds.Count == 0)
            return Ignored("The webhook did not match a configured integration connection.");

        var connections = await db.IntegrationConnections
            .Include(connection => connection.IntegrationProvider)
            .Where(connection => connectionIds.Contains(connection.Id))
            .ToListAsync(cancellationToken);
        var activeConnections = connections
            .Where(connection => connection.Enabled &&
                                 connection.Status == Models.IntegrationConnectionStatus.Active &&
                                 connection.SyncMode == Models.IntegrationSyncMode.Webhook)
            .ToList();
        if (activeConnections.Count == 0)
        {
            var matchedPollingConnection = connections.Any(connection =>
                connection.Enabled &&
                connection.Status == Models.IntegrationConnectionStatus.Active &&
                connection.SyncMode == Models.IntegrationSyncMode.Polling);
            return Ignored(matchedPollingConnection
                ? "The matched integration connection is configured for scheduled polling."
                : "The matched integration connection is not enabled and active.");
        }

        var service = scope.ServiceProvider.GetRequiredService<IntegrationService>();
        foreach (var connection in activeConnections)
        {
            logger.LogInformation(
                "Webhook-triggered sync started for {Provider} connection {ConnectionId} ({EventType}).",
                envelope.Provider,
                connection.Id,
                envelope.EventType ?? "unknown event");
            var result = await service.SyncConnectionAsync(connection.Id, cancellationToken);
            if (result is null || !result.Succeeded)
            {
                logger.LogWarning(
                    "Webhook-triggered sync failed for {Provider} connection {ConnectionId}.",
                    envelope.Provider,
                    connection.Id);
                return new WebhookDispatchResult
                {
                    Status = WebhookDispatchStatus.Retry,
                    Message = "The integration synchronization failed; the relay should retry the event.",
                    ConnectionIds = activeConnections.Select(candidate => candidate.Id).ToArray()
                };
            }
        }

        logger.LogInformation(
            "Webhook-triggered sync completed for {Provider} connection(s) {ConnectionIds}.",
            envelope.Provider,
            string.Join(',', activeConnections.Select(connection => connection.Id)));
        return new WebhookDispatchResult
        {
            Status = WebhookDispatchStatus.Processed,
            Message = "The webhook-triggered synchronization completed.",
            ConnectionIds = activeConnections.Select(connection => connection.Id).ToArray()
        };
    }

    private static WebhookDispatchResult Ignored(string message) => new()
    {
        Status = WebhookDispatchStatus.Ignored,
        Message = message
    };
}
