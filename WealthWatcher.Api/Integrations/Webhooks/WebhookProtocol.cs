using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Integrations.Webhooks;

internal static class WebhookMessageTypes
{
    public const string Webhook = "webhook";
    public const string Ack = "ack";
    public const string Ping = "ping";
    public const string Pong = "pong";
    public const string Hello = "hello";
}

internal sealed record RelayWebhookMessage
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = WebhookMessageTypes.Webhook;

    [JsonPropertyName("messageId")]
    public required string MessageId { get; init; }

    [JsonPropertyName("event")]
    public required WebhookEnvelope Event { get; init; }
}

internal sealed record RelayAcknowledgement
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = WebhookMessageTypes.Ack;

    [JsonPropertyName("messageId")]
    public required string MessageId { get; init; }

    [JsonPropertyName("status")]
    public required string Status { get; init; }
}

internal sealed record RelayControlMessage
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }
}
