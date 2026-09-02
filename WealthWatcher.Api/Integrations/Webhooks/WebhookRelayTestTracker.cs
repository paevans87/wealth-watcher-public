using System.Collections.Concurrent;
using System.Text.Json;

namespace WealthWatcher.Api.Integrations.Webhooks;

internal static class WebhookRelayTestProtocol
{
    public const string ProviderKey = "wealth-watcher";
    public const string EventType = "relay_test";

    public static bool TryReadTestId(WebhookEnvelope envelope, out string testId)
    {
        testId = string.Empty;
        if (!string.Equals(envelope.Provider, ProviderKey, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(envelope.EventType, EventType, StringComparison.OrdinalIgnoreCase) ||
            envelope.Payload.ValueKind != JsonValueKind.Object ||
            !envelope.Payload.TryGetProperty("testId", out var value) ||
            value.ValueKind != JsonValueKind.String)
            return false;

        testId = value.GetString()?.Trim() ?? string.Empty;
        return testId.Length > 0;
    }
}

public sealed class WebhookRelayTestTracker
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<DateTimeOffset>> pending =
        new(StringComparer.OrdinalIgnoreCase);

    public void Register(string testId)
    {
        pending[testId] = new TaskCompletionSource<DateTimeOffset>(
            TaskCreationOptions.RunContinuationsAsynchronously);
    }

    public bool MarkReceived(string testId, DateTimeOffset receivedAt) =>
        pending.TryGetValue(testId, out var completion) &&
        completion.TrySetResult(receivedAt);

    public async Task<DateTimeOffset?> WaitForReceiptAsync(
        string testId,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        if (!pending.TryGetValue(testId, out var completion))
            return null;

        try
        {
            return await completion.Task.WaitAsync(timeout, cancellationToken);
        }
        catch (TimeoutException)
        {
            return null;
        }
        finally
        {
            pending.TryRemove(testId, out _);
        }
    }

    public void Remove(string testId) => pending.TryRemove(testId, out _);
}
