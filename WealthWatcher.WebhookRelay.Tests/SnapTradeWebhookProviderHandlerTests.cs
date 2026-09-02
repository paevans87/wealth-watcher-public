using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using WealthWatcher.WebhookRelay;
using Xunit;

namespace WealthWatcher.WebhookRelay.Tests;

public sealed class SnapTradeWebhookProviderHandlerTests
{
    [Fact]
    public async Task Valid_sorted_json_signature_is_accepted()
    {
        var timestamp = DateTimeOffset.UtcNow;
        const string consumerKey = "consumer-key";
        var body = $$"""
            {"webhookId":"event-1","userId":"user-1","eventType":"ACCOUNT_HOLDINGS_UPDATED","eventTimestamp":"{{timestamp:O}}","clientId":"client-1","accountId":"account-1"}
            """;
        var canonicalBody = $$"""
            {"accountId":"account-1","clientId":"client-1","eventTimestamp":"{{timestamp:O}}","eventType":"ACCOUNT_HOLDINGS_UPDATED","userId":"user-1","webhookId":"event-1"}
            """;
        var signature = Sign(canonicalBody, consumerKey);
        var handler = CreateHandler(consumerKey, timestamp);

        var result = await handler.HandleAsync(new ProviderWebhookRequest(
            "installation-1",
            "snaptrade",
            Encoding.UTF8.GetBytes(body),
            new Dictionary<string, string> { ["Signature"] = signature }));

        Assert.True(result.Accepted, result.RejectionMessage);
        Assert.Equal("event-1", result.MessageId);
        Assert.Equal("ACCOUNT_HOLDINGS_UPDATED", result.EventType);
    }

    [Fact]
    public async Task Invalid_signature_is_rejected_without_forwarding_the_payload()
    {
        var timestamp = DateTimeOffset.UtcNow;
        const string body = "{\"eventTimestamp\":\"2026-09-02T12:00:00Z\",\"eventType\":\"ACCOUNT_HOLDINGS_UPDATED\",\"webhookId\":\"event-2\"}";
        var handler = CreateHandler("consumer-key", timestamp);

        var result = await handler.HandleAsync(new ProviderWebhookRequest(
            "installation-1",
            "snaptrade",
            Encoding.UTF8.GetBytes(body),
            new Dictionary<string, string> { ["Signature"] = "not-valid" }));

        Assert.False(result.Accepted);
        Assert.Equal(StatusCodes.Status401Unauthorized, result.RejectionStatusCode);
        Assert.Equal(JsonValueKind.Undefined, result.Payload.ValueKind);
    }

    [Fact]
    public async Task Stale_signed_webhook_is_rejected()
    {
        var timestamp = DateTimeOffset.UtcNow.AddMinutes(-6);
        const string consumerKey = "consumer-key";
        var body = $$"""
            {"eventTimestamp":"{{timestamp:O}}","eventType":"ACCOUNT_HOLDINGS_UPDATED","webhookId":"event-3"}
            """;
        var handler = CreateHandler(consumerKey, DateTimeOffset.UtcNow);

        var result = await handler.HandleAsync(new ProviderWebhookRequest(
            "installation-1",
            "snaptrade",
            Encoding.UTF8.GetBytes(body),
            new Dictionary<string, string> { ["Signature"] = Sign(body, consumerKey) }));

        Assert.False(result.Accepted);
        Assert.Equal(StatusCodes.Status400BadRequest, result.RejectionStatusCode);
    }

    private static SnapTradeWebhookProviderHandler CreateHandler(
        string consumerKey,
        DateTimeOffset now) =>
        new(
            Options.Create(new RelayOptions
            {
                Providers = new Dictionary<string, RelayProviderOptions>(StringComparer.OrdinalIgnoreCase)
                {
                    ["snaptrade"] = new RelayProviderOptions { ConsumerKey = consumerKey }
                }
            }),
            new FixedTimeProvider(now));

    private static string Sign(string body, string consumerKey)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(consumerKey));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(body)));
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
