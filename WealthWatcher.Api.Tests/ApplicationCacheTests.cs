using Microsoft.Extensions.Caching.Memory;
using WealthWatcher.Api.Caching;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class ApplicationCacheTests
{
    [Fact]
    public async Task In_memory_cache_coalesces_concurrent_factories()
    {
        using var memoryCache = new MemoryCache(new MemoryCacheOptions());
        var cache = new InMemoryApplicationCache(memoryCache);
        var factoryStarted = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFactory = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var factoryCalls = 0;

        Task<int> Factory(CancellationToken _)
        {
            Interlocked.Increment(ref factoryCalls);
            factoryStarted.SetResult(true);
            return WaitForValueAsync();

            async Task<int> WaitForValueAsync()
            {
                await releaseFactory.Task;
                return 42;
            }
        }

        var first = cache.GetOrCreateAsync("test:key", Factory, TimeSpan.FromMinutes(1));
        await factoryStarted.Task;
        var second = cache.GetOrCreateAsync("test:key", Factory, TimeSpan.FromMinutes(1));

        Assert.Equal(1, factoryCalls);
        releaseFactory.SetResult(true);
        Assert.Equal(42, await first);
        Assert.Equal(42, await second);
        Assert.Equal(1, factoryCalls);
    }

    [Fact]
    public async Task Tag_invalidation_removes_cached_values()
    {
        using var memoryCache = new MemoryCache(new MemoryCacheOptions());
        var cache = new InMemoryApplicationCache(memoryCache);
        var factoryCalls = 0;

        Task<int> Factory(CancellationToken _) => Task.FromResult(Interlocked.Increment(ref factoryCalls));

        Assert.Equal(1, await cache.GetOrCreateAsync(
            "test:tagged",
            Factory,
            TimeSpan.FromMinutes(1),
            [CacheTags.Wealth]));
        Assert.Equal(1, await cache.GetOrCreateAsync(
            "test:tagged",
            Factory,
            TimeSpan.FromMinutes(1),
            [CacheTags.Wealth]));

        await cache.RemoveByTagAsync(CacheTags.Wealth);

        Assert.Equal(2, await cache.GetOrCreateAsync(
            "test:tagged",
            Factory,
            TimeSpan.FromMinutes(1),
            [CacheTags.Wealth]));
    }

    [Fact]
    public async Task Invalidation_during_population_does_not_store_the_in_flight_result()
    {
        using var memoryCache = new MemoryCache(new MemoryCacheOptions());
        var cache = new InMemoryApplicationCache(memoryCache);
        var factoryStarted = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFactory = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var factoryCalls = 0;

        async Task<int> Factory(CancellationToken _)
        {
            var call = Interlocked.Increment(ref factoryCalls);
            if (call == 1)
            {
                factoryStarted.SetResult(true);
                await releaseFactory.Task;
            }

            return call;
        }

        var first = cache.GetOrCreateAsync(
            "test:in-flight",
            Factory,
            TimeSpan.FromMinutes(1),
            [CacheTags.Wealth]);
        await factoryStarted.Task;

        await cache.RemoveByTagAsync(CacheTags.Wealth);
        releaseFactory.SetResult(true);

        Assert.Equal(1, await first);
        Assert.Equal(2, await cache.GetOrCreateAsync(
            "test:in-flight",
            Factory,
            TimeSpan.FromMinutes(1),
            [CacheTags.Wealth]));
    }
}
