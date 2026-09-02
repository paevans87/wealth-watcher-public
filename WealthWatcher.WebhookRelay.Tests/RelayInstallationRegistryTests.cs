using Microsoft.Extensions.Options;
using WealthWatcher.WebhookRelay;
using Xunit;

namespace WealthWatcher.WebhookRelay.Tests;

public sealed class RelayInstallationRegistryTests
{
    [Fact]
    public void Installation_tokens_are_compared_without_exposing_or_logging_them()
    {
        var registry = new RelayInstallationRegistry(Options.Create(new RelayOptions
        {
            Installations =
            [
                new RelayInstallationOptions { Id = "installation-1", Token = "long-secret-token" }
            ]
        }));

        Assert.True(registry.Authenticate("installation-1", "long-secret-token"));
        Assert.False(registry.Authenticate("installation-1", "wrong-token"));
        Assert.False(registry.Authenticate("unknown", "long-secret-token"));
    }

    [Fact]
    public void Public_webhook_routing_uses_the_single_configured_pairing()
    {
        var registry = new RelayInstallationRegistry(Options.Create(new RelayOptions
        {
            Installations =
            [
                new RelayInstallationOptions { Id = "private-pairing", Token = "long-secret-token" }
            ]
        }));

        Assert.True(registry.TryGetSingleInstallationId(out var installationId));
        Assert.Equal("private-pairing", installationId);
    }

    [Fact]
    public void Public_webhook_routing_requires_exactly_one_configured_pairing()
    {
        var registry = new RelayInstallationRegistry(Options.Create(new RelayOptions()));

        Assert.False(registry.TryGetSingleInstallationId(out var installationId));
        Assert.Equal(string.Empty, installationId);
    }

    [Fact]
    public void Public_webhook_routing_rejects_multiple_configured_pairings()
    {
        var registry = new RelayInstallationRegistry(Options.Create(new RelayOptions
        {
            Installations =
            [
                new RelayInstallationOptions { Id = "pairing-1", Token = "token-1" },
                new RelayInstallationOptions { Id = "pairing-2", Token = "token-2" }
            ]
        }));

        Assert.False(registry.TryGetSingleInstallationId(out _));
    }
}
