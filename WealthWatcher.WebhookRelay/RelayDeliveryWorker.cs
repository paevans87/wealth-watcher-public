using Microsoft.Extensions.Options;

namespace WealthWatcher.WebhookRelay;

public sealed class RelayDeliveryWorker(
    IRelayMessageStore store,
    RelayConnectionManager connections,
    IOptions<RelayOptions> options,
    ILogger<RelayDeliveryWorker> logger) : BackgroundService
{
    private DateTimeOffset nextCleanupAt = DateTimeOffset.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var relayOptions = options.Value;
                var messages = await store.GetDueAsync(DateTimeOffset.UtcNow, 25, stoppingToken);
                if (messages.Count == 0)
                {
                    await Task.Delay(
                        TimeSpan.FromSeconds(relayOptions.DeliveryPollIntervalSeconds),
                        stoppingToken);
                }
                else
                {
                    foreach (var message in messages)
                        await DeliverAsync(message, relayOptions, stoppingToken);
                }

                if (DateTimeOffset.UtcNow >= nextCleanupAt)
                {
                    await store.RemoveExpiredAsync(
                        DateTimeOffset.UtcNow.AddDays(-relayOptions.RetentionDays),
                        stoppingToken);
                    nextCleanupAt = DateTimeOffset.UtcNow.AddHours(1);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Webhook relay delivery cycle failed.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task DeliverAsync(
        RelayMessage message,
        RelayOptions relayOptions,
        CancellationToken cancellationToken)
    {
        if (!connections.TryGet(message.InstallationId, out var connection) || connection is null)
        {
            await store.RescheduleAsync(
                message,
                DateTimeOffset.UtcNow.AddSeconds(15),
                "Wealth Watcher installation is not connected.",
                cancellationToken);
            return;
        }

        var attempt = await store.MarkAttemptAsync(message, cancellationToken);
        if (!attempt.HasValue)
            return;

        try
        {
            var result = await connection.DeliverAsync(
                message,
                TimeSpan.FromSeconds(relayOptions.DeliveryAckTimeoutSeconds),
                cancellationToken);
            if (result.Acknowledged)
            {
                await store.MarkDeliveredAsync(message, cancellationToken);
                logger.LogInformation(
                    "Webhook delivered and acknowledged for {InstallationId} {Provider} {MessageId}.",
                    message.InstallationId,
                    message.Provider,
                    message.MessageId);
                return;
            }

            await RescheduleAfterFailureAsync(message, attempt.Value, result.Status ?? "No acknowledgement received.", cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Webhook delivery failed for {InstallationId} {Provider} {MessageId}.",
                message.InstallationId,
                message.Provider,
                message.MessageId);
            await RescheduleAfterFailureAsync(message, attempt.Value, "Delivery failed.", cancellationToken);
        }
    }

    private Task RescheduleAfterFailureAsync(
        RelayMessage message,
        int attempt,
        string error,
        CancellationToken cancellationToken)
    {
        var cappedAttempt = Math.Min(Math.Max(attempt - 1, 0), 6);
        var seconds = Math.Min(60, Math.Pow(2, cappedAttempt));
        var jitter = Random.Shared.NextDouble();
        return store.RescheduleAsync(
            message,
            DateTimeOffset.UtcNow.AddSeconds(seconds + jitter),
            error,
            cancellationToken);
    }
}
