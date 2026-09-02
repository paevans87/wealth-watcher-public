namespace WealthWatcher.Api.Integrations.Webhooks;

public enum WebhookDispatchStatus
{
    Processed,
    Ignored,
    Retry
}

/// <summary>
/// Describes how the API handled a relay event and whether the relay may stop retrying it.
/// </summary>
public sealed record WebhookDispatchResult
{
    public required WebhookDispatchStatus Status { get; init; }
    public string Message { get; init; } = string.Empty;
    public IReadOnlyList<Guid> ConnectionIds { get; init; } = [];

    public bool ShouldAcknowledge => Status != WebhookDispatchStatus.Retry;
}
