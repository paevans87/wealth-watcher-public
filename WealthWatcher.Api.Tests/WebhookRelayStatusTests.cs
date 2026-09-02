using WealthWatcher.Api.Integrations.Webhooks;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class WebhookRelayStatusTests
{
    [Fact]
    public void Snapshot_reports_safe_connection_configuration_without_the_token()
    {
        var status = new WebhookRelayStatus();
        var snapshot = status.Snapshot(new WebhookRelayOptions
        {
            Enabled = true,
            Url = new Uri("wss://relay.example.com/ws"),
            PublicBaseUrl = new Uri("https://relay.example.com/"),
            InstallationId = "installation-1",
            Token = "do-not-expose"
        });

        Assert.True(snapshot.Enabled);
        Assert.False(snapshot.Connected);
        Assert.Equal("wss://relay.example.com/ws", snapshot.RelayUrl);
        Assert.Equal("https://relay.example.com", snapshot.RelayPublicBaseUrl);
        Assert.DoesNotContain("do-not-expose", string.Join('|',
            snapshot.RelayUrl,
            snapshot.RelayPublicBaseUrl,
            snapshot.LastError));
    }

    [Fact]
    public void Snapshot_hides_deployment_values_when_relay_is_disabled()
    {
        var status = new WebhookRelayStatus();
        var snapshot = status.Snapshot(new WebhookRelayOptions
        {
            Enabled = false,
            Url = new Uri("wss://relay.example.com/ws"),
            PublicBaseUrl = new Uri("https://relay.example.com"),
            InstallationId = "installation-1",
            Token = "do-not-expose"
        });

        Assert.False(snapshot.Enabled);
        Assert.Null(snapshot.RelayUrl);
        Assert.Null(snapshot.RelayPublicBaseUrl);
    }
}
