namespace WealthWatcher.Api.Integrations.Webhooks;

public interface IWebhookDispatcher
{
    Task<WebhookDispatchResult> DispatchAsync(
        WebhookEnvelope envelope,
        CancellationToken cancellationToken = default);
}
