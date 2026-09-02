using System.Text.Json;
using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Integrations.Webhooks;

/// <summary>
/// Represents a provider event forwarded by the external webhook relay.
/// </summary>
public sealed record WebhookEnvelope
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("provider")]
    public required string Provider { get; init; }

    [JsonPropertyName("eventType")]
    public string? EventType { get; init; }

    [JsonPropertyName("receivedAt")]
    public required DateTimeOffset ReceivedAt { get; init; }

    [JsonPropertyName("headers")]
    public IReadOnlyDictionary<string, string> Headers { get; init; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    [JsonPropertyName("payload")]
    public required JsonElement Payload { get; init; }
}
