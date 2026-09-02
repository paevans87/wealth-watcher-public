using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace WealthWatcher.WebhookRelay;

/// <summary>
/// Validates and normalizes SnapTrade webhook requests at the public trust boundary.
/// </summary>
public sealed class SnapTradeWebhookProviderHandler(
    IOptions<RelayOptions> options,
    TimeProvider timeProvider) : IWebhookProviderHandler
{
    public const string ProviderKeyValue = "snaptrade";
    private static readonly TimeSpan MaximumEventAge = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MaximumFutureSkew = TimeSpan.FromMinutes(5);

    public string ProviderKey => ProviderKeyValue;

    public Task<ProviderWebhookResult> HandleAsync(
        ProviderWebhookRequest request,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var providerOptions = options.Value.Providers
            .FirstOrDefault(pair => string.Equals(pair.Key, ProviderKeyValue, StringComparison.OrdinalIgnoreCase))
            .Value;
        var consumerKey = providerOptions?.ConsumerKey;
        if (string.IsNullOrWhiteSpace(consumerKey))
        {
            return Task.FromResult(ProviderWebhookResult.Reject(
                StatusCodes.Status503ServiceUnavailable,
                "SnapTrade webhook validation is not configured on this relay."));
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(request.Body);
        }
        catch (JsonException)
        {
            return Task.FromResult(ProviderWebhookResult.Reject(
                StatusCodes.Status400BadRequest,
                "The webhook body is not valid JSON."));
        }

        using (document)
        {
            var payload = document.RootElement;
            if (payload.ValueKind != JsonValueKind.Object)
            {
                return Task.FromResult(ProviderWebhookResult.Reject(
                    StatusCodes.Status400BadRequest,
                    "The webhook body must be a JSON object."));
            }

            if (!TryGetHeader(request.Headers, "Signature", out var signature) ||
                !IsValidSignature(payload, request.Body.Span, signature, consumerKey))
            {
                return Task.FromResult(ProviderWebhookResult.Reject(
                    StatusCodes.Status401Unauthorized,
                    "The webhook signature is invalid."));
            }

            var messageId = GetString(payload, "webhookId") ?? GetString(payload, "webookId");
            var eventType = GetString(payload, "eventType");
            if (string.IsNullOrWhiteSpace(messageId) || string.IsNullOrWhiteSpace(eventType))
            {
                return Task.FromResult(ProviderWebhookResult.Reject(
                    StatusCodes.Status400BadRequest,
                    "The webhook is missing its event identity."));
            }

            if (!DateTimeOffset.TryParse(
                    GetString(payload, "eventTimestamp"),
                    out var eventTimestamp))
            {
                return Task.FromResult(ProviderWebhookResult.Reject(
                    StatusCodes.Status400BadRequest,
                    "The webhook timestamp is invalid."));
            }

            var age = timeProvider.GetUtcNow() - eventTimestamp.ToUniversalTime();
            if (age > MaximumEventAge || age < -MaximumFutureSkew)
            {
                return Task.FromResult(ProviderWebhookResult.Reject(
                    StatusCodes.Status400BadRequest,
                    "The webhook timestamp is outside the accepted window."));
            }

            return Task.FromResult(new ProviderWebhookResult
            {
                Accepted = true,
                MessageId = messageId,
                EventType = eventType,
                ReceivedAt = timeProvider.GetUtcNow(),
                Payload = payload.Clone(),
                ForwardedHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["Signature"] = signature
                }
            });
        }
    }

    private static bool IsValidSignature(
        JsonElement payload,
        ReadOnlySpan<byte> rawBody,
        string suppliedSignature,
        string consumerKey)
    {
        var canonicalSignature = ComputeSignature(JsonCanonicalizer.Serialize(payload), consumerKey);
        if (FixedTimeBase64Equals(canonicalSignature, suppliedSignature))
            return true;

        // SnapTrade's current example signs compact, sorted JSON. Accepting the
        // raw body as a compatibility fallback also handles older webhook senders
        // without weakening the shared-secret HMAC check.
        var rawSignature = ComputeSignature(rawBody, consumerKey);
        return FixedTimeBase64Equals(rawSignature, suppliedSignature);
    }

    private static string ComputeSignature(ReadOnlySpan<byte> content, string consumerKey)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(consumerKey));
        return Convert.ToBase64String(hmac.ComputeHash(content.ToArray()));
    }

    private static bool FixedTimeBase64Equals(string expected, string supplied)
    {
        try
        {
            var expectedBytes = Convert.FromBase64String(expected);
            var suppliedBytes = Convert.FromBase64String(supplied);
            return CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool TryGetHeader(
        IReadOnlyDictionary<string, string> headers,
        string name,
        out string value)
    {
        var pair = headers.FirstOrDefault(header =>
            string.Equals(header.Key, name, StringComparison.OrdinalIgnoreCase));
        value = pair.Value;
        return !string.IsNullOrWhiteSpace(value);
    }

    private static string? GetString(JsonElement payload, string name) =>
        payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
