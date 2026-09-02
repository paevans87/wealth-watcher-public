using WealthWatcher.WebhookRelay;
using Xunit;

namespace WealthWatcher.WebhookRelay.Tests;

public sealed class RelayMessageStoreTests
{
    [Fact]
    public async Task Events_are_durable_and_duplicate_provider_deliveries_are_idempotent()
    {
        var path = Path.Combine(Path.GetTempPath(), $"wealth-watcher-relay-{Guid.NewGuid():N}.db");
        try
        {
            var message = new RelayMessage
            {
                MessageId = "event-1",
                InstallationId = "installation-1",
                Provider = "snaptrade",
                EventType = "ACCOUNT_HOLDINGS_UPDATED",
                ReceivedAt = DateTimeOffset.UtcNow,
                Headers = new Dictionary<string, string> { ["Signature"] = "redacted" },
                PayloadJson = "{\"webhookId\":\"event-1\"}"
            };
            var store = new RelayMessageStore($"Data Source={path}");
            await store.InitializeAsync();

            Assert.True((await store.EnqueueAsync(message)).Added);
            Assert.False((await store.EnqueueAsync(message)).Added);
            var pending = await store.GetDueAsync(DateTimeOffset.UtcNow, 10);
            Assert.Single(pending);

            var attempt = await store.MarkAttemptAsync(pending[0]);
            Assert.Equal(1, attempt);
            await store.RescheduleAsync(pending[0], DateTimeOffset.UtcNow, "temporary failure");

            var reopened = new RelayMessageStore($"Data Source={path}");
            await reopened.InitializeAsync();
            Assert.Single(await reopened.GetDueAsync(DateTimeOffset.UtcNow, 10));

            await reopened.MarkDeliveredAsync(message);
            Assert.Empty(await reopened.GetDueAsync(DateTimeOffset.UtcNow.AddMinutes(1), 10));
            Assert.True(await reopened.CanConnectAsync());
        }
        finally
        {
            if (File.Exists(path))
                File.Delete(path);
        }
    }
}
