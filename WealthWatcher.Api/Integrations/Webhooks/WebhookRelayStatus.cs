namespace WealthWatcher.Api.Integrations.Webhooks;

public sealed class WebhookRelayStatus
{
    private readonly object sync = new();
    private bool connected;
    private DateTimeOffset? lastConnectedAt;
    private DateTimeOffset? lastMessageAt;
    private DateTimeOffset? lastTestAt;
    private string? lastTestId;
    private string? lastError;

    public void MarkConnecting()
    {
        lock (sync)
        {
            connected = false;
            lastError = null;
        }
    }

    public void MarkConnected(DateTimeOffset connectedAt)
    {
        lock (sync)
        {
            connected = true;
            lastConnectedAt = connectedAt;
            lastError = null;
        }
    }

    public void MarkDisconnected(string? error = null)
    {
        lock (sync)
        {
            connected = false;
            lastError = string.IsNullOrWhiteSpace(error) ? null : "Relay connection unavailable.";
        }
    }

    public void MarkDisabled()
    {
        lock (sync)
        {
            connected = false;
            lastError = null;
        }
    }

    public void MarkMessageReceived(DateTimeOffset receivedAt)
    {
        lock (sync)
        {
            lastMessageAt = receivedAt;
        }
    }

    public void MarkTestReceived(string testId, DateTimeOffset receivedAt)
    {
        lock (sync)
        {
            lastTestId = testId;
            lastTestAt = receivedAt;
        }
    }

    public WebhookRelayStatusResponse Snapshot(WebhookRelayOptions options)
        => Snapshot(options, null);

    public WebhookRelayStatusResponse Snapshot(
        WebhookRelayOptions options,
        WebhookRelayControl? control)
    {
        lock (sync)
        {
            var configured = options.Enabled;
            var enabled = configured && (control?.Enabled ?? true);
            return new WebhookRelayStatusResponse
            {
                Configured = configured,
                Enabled = enabled,
                CanToggle = configured,
                CanTest = enabled && options.Url is not null &&
                          !string.IsNullOrWhiteSpace(options.InstallationId) &&
                          !string.IsNullOrWhiteSpace(options.Token),
                Connected = enabled && connected,
                RelayUrl = configured ? options.Url?.ToString() : null,
                RelayPublicBaseUrl = configured ? options.PublicBaseUrl?.ToString().TrimEnd('/') : null,
                LastConnectedAt = lastConnectedAt,
                LastMessageAt = lastMessageAt,
                LastTestAt = lastTestAt,
                LastTestId = lastTestId,
                LastError = lastError
            };
        }
    }
}

public sealed class WebhookRelayStatusResponse
{
    public bool Configured { get; init; }
    public bool Enabled { get; init; }
    public bool CanToggle { get; init; }
    public bool CanTest { get; init; }
    public bool Connected { get; init; }
    public string? RelayUrl { get; init; }
    public string? RelayPublicBaseUrl { get; init; }
    public DateTimeOffset? LastConnectedAt { get; init; }
    public DateTimeOffset? LastMessageAt { get; init; }
    public DateTimeOffset? LastTestAt { get; init; }
    public string? LastTestId { get; init; }
    public string? LastError { get; init; }
}
