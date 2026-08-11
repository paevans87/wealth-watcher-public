using Microsoft.Extensions.DependencyInjection;
using WealthWatcher.Api.Integrations;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class ProviderRateLimiterTests
{
    [Fact]
    public async Task Rate_limit_bucket_is_shared_by_provider_key()
    {
        var limiter = new ProviderRateLimiter(TimeProvider.System);
        var rules = new[]
        {
            new ProviderRateLimitRule("provider", 1, TimeSpan.FromHours(1))
        };

        await limiter.WaitAsync("trading212", rules, CancellationToken.None);

        using var cancellation = new CancellationTokenSource();
        var blocked = limiter.WaitAsync("trading212", rules, cancellation.Token);
        Assert.False(blocked.IsCompleted);

        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => blocked);
    }

    [Fact]
    public async Task Different_providers_have_independent_buckets()
    {
        var limiter = new ProviderRateLimiter(TimeProvider.System);
        var rules = new[]
        {
            new ProviderRateLimitRule("provider", 1, TimeSpan.FromHours(1))
        };

        await limiter.WaitAsync("trading212", rules, CancellationToken.None);
        await limiter.WaitAsync("snaptrade", rules, CancellationToken.None);
    }

    [Fact]
    public void Typed_integration_adapters_resolve_with_the_shared_rate_limiter()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IProviderRateLimiter, ProviderRateLimiter>();
        services.AddHttpClient<Trading212IntegrationAdapter>();
        services.AddHttpClient<SnaptradeIntegrationAdapter>();

        using var provider = services.BuildServiceProvider();

        Assert.NotNull(provider.GetRequiredService<Trading212IntegrationAdapter>());
        Assert.NotNull(provider.GetRequiredService<SnaptradeIntegrationAdapter>());
    }
}
