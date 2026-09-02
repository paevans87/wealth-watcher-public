using System.Text.Json;

namespace WealthWatcher.WebhookRelay;

public sealed record ProviderWebhookRequest(
    string InstallationId,
    string Provider,
    ReadOnlyMemory<byte> Body,
    IReadOnlyDictionary<string, string> Headers);

public sealed class ProviderWebhookResult
{
    public bool Accepted { get; init; }
    public int RejectionStatusCode { get; init; } = StatusCodes.Status400BadRequest;
    public string RejectionMessage { get; init; } = "The webhook request was rejected.";
    public string? MessageId { get; init; }
    public string? EventType { get; init; }
    public DateTimeOffset ReceivedAt { get; init; }
    public JsonElement Payload { get; init; }
    public IReadOnlyDictionary<string, string> ForwardedHeaders { get; init; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public static ProviderWebhookResult Reject(
        int statusCode,
        string message) => new()
    {
        Accepted = false,
        RejectionStatusCode = statusCode,
        RejectionMessage = message
    };
}

public interface IWebhookProviderHandler
{
    string ProviderKey { get; }

    Task<ProviderWebhookResult> HandleAsync(
        ProviderWebhookRequest request,
        CancellationToken cancellationToken = default);
}
