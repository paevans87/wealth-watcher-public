using System.Collections.Concurrent;
using Microsoft.Extensions.Caching.Memory;

namespace WealthWatcher.Api.Caching;

public sealed class InMemoryApplicationCache(IMemoryCache cache) : IApplicationCache
{
    private readonly ConcurrentDictionary<string, Lazy<Task<object?>>> inFlight = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> keysByTag =
        new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, long> keyVersions = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, long> tagVersions = new(StringComparer.Ordinal);

    public async Task<T> GetOrCreateAsync<T>(
        string key,
        Func<CancellationToken, Task<T>> factory,
        TimeSpan absoluteExpiration,
        IReadOnlyCollection<string>? tags = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        ArgumentNullException.ThrowIfNull(factory);

        if (cache.TryGetValue(key, out var cached))
            return (T)cached!;

        var keyVersion = GetVersion(keyVersions, key);
        var tagVersionSnapshot = CaptureTagVersions(tags);

        var lazy = inFlight.GetOrAdd(
            key,
            _ => new Lazy<Task<object?>>(
                () => PopulateAsync(key, factory, absoluteExpiration, tags, keyVersion, tagVersionSnapshot),
                LazyThreadSafetyMode.ExecutionAndPublication));

        try
        {
            return (T)(await lazy.Value.WaitAsync(cancellationToken).ConfigureAwait(false))!;
        }
        finally
        {
            inFlight.TryRemove(new KeyValuePair<string, Lazy<Task<object?>>>(key, lazy));
        }
    }

    public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        IncrementVersion(keyVersions, key);
        cache.Remove(key);
        RemoveKeyFromTags(key);
        return Task.CompletedTask;
    }

    public Task RemoveByTagAsync(string tag, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        IncrementVersion(tagVersions, tag);
        if (keysByTag.TryGetValue(tag, out var keys))
        {
            foreach (var key in keys.Keys.ToArray())
                cache.Remove(key);

            keysByTag.TryRemove(tag, out _);
        }

        return Task.CompletedTask;
    }

    private async Task<object?> PopulateAsync<T>(
        string key,
        Func<CancellationToken, Task<T>> factory,
        TimeSpan absoluteExpiration,
        IReadOnlyCollection<string>? tags,
        long keyVersion,
        IReadOnlyDictionary<string, long> tagVersionSnapshot)
    {
        if (cache.TryGetValue(key, out var cached) && VersionsUnchanged(key, keyVersion, tagVersionSnapshot))
            return cached;

        var value = await factory(CancellationToken.None).ConfigureAwait(false);
        if (!VersionsUnchanged(key, keyVersion, tagVersionSnapshot))
            return value;

        var options = new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = absoluteExpiration
        };
        options.RegisterPostEvictionCallback((evictedKey, _, _, _) =>
        {
            if (evictedKey is string stringKey)
                RemoveKeyFromTags(stringKey);
        });

        cache.Set(key, value, options);
        foreach (var tag in tags ?? Array.Empty<string>())
        {
            if (string.IsNullOrWhiteSpace(tag)) continue;
            var tagKeys = keysByTag.GetOrAdd(tag, _ => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal));
            tagKeys[key] = 0;
        }

        if (!VersionsUnchanged(key, keyVersion, tagVersionSnapshot))
        {
            cache.Remove(key);
            RemoveKeyFromTags(key);
        }

        return value;
    }

    private Dictionary<string, long> CaptureTagVersions(IReadOnlyCollection<string>? tags) =>
        (tags ?? Array.Empty<string>())
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Distinct(StringComparer.Ordinal)
            .ToDictionary(tag => tag, tag => GetVersion(tagVersions, tag), StringComparer.Ordinal);

    private bool VersionsUnchanged(string key, long keyVersion, IReadOnlyDictionary<string, long> tagVersionSnapshot) =>
        GetVersion(keyVersions, key) == keyVersion &&
        tagVersionSnapshot.All(pair => GetVersion(tagVersions, pair.Key) == pair.Value);

    private static long GetVersion(ConcurrentDictionary<string, long> versions, string key) =>
        versions.TryGetValue(key, out var version) ? version : 0;

    private static void IncrementVersion(ConcurrentDictionary<string, long> versions, string key) =>
        versions.AddOrUpdate(key, 1, static (_, current) => current + 1);

    private void RemoveKeyFromTags(string key)
    {
        foreach (var pair in keysByTag)
        {
            pair.Value.TryRemove(key, out _);
            if (pair.Value.IsEmpty)
                keysByTag.TryRemove(pair.Key, out _);
        }
    }
}
