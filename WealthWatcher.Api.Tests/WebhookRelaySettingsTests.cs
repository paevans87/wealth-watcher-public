using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Integrations.Webhooks;
using WealthWatcher.Api.Models;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class WebhookRelaySettingsTests
{
    [Fact]
    public async Task User_relay_switch_is_persisted_and_updates_runtime_control()
    {
        await using var db = CreateDatabase();
        var options = Options.Create(new WebhookRelayOptions
        {
            Enabled = true,
            Url = new Uri("ws://relay.example.com/ws"),
            InstallationId = "installation-1",
            Token = "secret"
        });
        var control = new WebhookRelayControl(options);
        var service = new WebhookRelaySettingsService(db, control, options);

        await service.SaveEnabledAsync(false);

        Assert.False(control.Enabled);
        Assert.False((await db.AppPreferences.SingleAsync()).WebhookRelayEnabled);

        await service.SaveEnabledAsync(true);

        Assert.True(control.Enabled);
        Assert.True((await db.AppPreferences.SingleAsync()).WebhookRelayEnabled);
    }

    [Fact]
    public async Task Disabling_the_relay_moves_webhook_connections_to_scheduled_polling()
    {
        await using var db = CreateDatabase();
        var provider = new IntegrationProvider
        {
            Code = "snaptrade",
            DisplayName = "SnapTrade"
        };
        db.IntegrationProviders.Add(provider);
        db.IntegrationConnections.Add(new IntegrationConnection
        {
            IntegrationProviderId = provider.Id,
            IntegrationProvider = provider,
            DisplayName = "SnapTrade connection",
            Status = IntegrationConnectionStatus.Active,
            SyncMode = IntegrationSyncMode.Webhook
        });
        await db.SaveChangesAsync();

        var options = Options.Create(new WebhookRelayOptions
        {
            Enabled = true,
            Url = new Uri("ws://relay.example.com/ws"),
            InstallationId = "installation-1",
            Token = "secret"
        });
        var control = new WebhookRelayControl(options);
        var service = new WebhookRelaySettingsService(db, control, options);

        await service.SaveEnabledAsync(false);

        var connection = await db.IntegrationConnections.SingleAsync();
        Assert.Equal(IntegrationSyncMode.Polling, connection.SyncMode);
        Assert.False(control.Enabled);
    }

    [Fact]
    public async Task Relay_cannot_be_enabled_from_the_ui_when_deployment_support_is_off()
    {
        await using var db = CreateDatabase();
        var options = Options.Create(new WebhookRelayOptions());
        var control = new WebhookRelayControl(options);
        var service = new WebhookRelaySettingsService(db, control, options);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.SaveEnabledAsync(true));

        Assert.Contains("deployment configuration", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(db.AppPreferences);
    }

    private static WealthDbContext CreateDatabase()
    {
        var options = new DbContextOptionsBuilder<WealthDbContext>()
            .UseInMemoryDatabase($"relay-settings-tests-{Guid.NewGuid():N}")
            .Options;
        return new WealthDbContext(options);
    }
}
