using System.Net;

namespace WealthWatcher.Api.Integrations;

public interface IProviderRateLimiter
{
    Task WaitAsync(
        string providerKey,
        IReadOnlyList<ProviderRateLimitRule> rules,
        CancellationToken cancellationToken);

    void Observe(
        string providerKey,
        IReadOnlyList<ProviderRateLimitRule> rules,
        HttpResponseMessage response);
}

public sealed class ProviderRateLimitRule
{
    public ProviderRateLimitRule(string bucket, int permitLimit, TimeSpan window)
    {
        if (string.IsNullOrWhiteSpace(bucket))
            throw new ArgumentException("A rate-limit bucket is required.", nameof(bucket));
        if (permitLimit < 1)
            throw new ArgumentOutOfRangeException(nameof(permitLimit));
        if (window <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(window));

        Bucket = bucket;
        PermitLimit = permitLimit;
        Window = window;
    }

    public string Bucket { get; }
    public int PermitLimit { get; }
    public TimeSpan Window { get; }
}

public sealed class ProviderRateLimiter(TimeProvider timeProvider) : IProviderRateLimiter
{
    private static readonly TimeSpan MaximumServerDelay = TimeSpan.FromMinutes(5);
    private readonly object sync = new();
    private readonly Dictionary<string, BucketState> buckets = new(StringComparer.Ordinal);

    public async Task WaitAsync(
        string providerKey,
        IReadOnlyList<ProviderRateLimitRule> rules,
        CancellationToken cancellationToken)
    {
        var normalizedRules = NormalizeRules(rules);
        if (normalizedRules.Count == 0) return;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var now = timeProvider.GetUtcNow();
            var delay = TimeSpan.Zero;

            lock (sync)
            {
                foreach (var rule in normalizedRules)
                {
                    var bucket = GetBucket(providerKey, rule.Bucket);
                    bucket.RemoveExpired(now, rule.Window);
                    delay = Max(delay, bucket.BlockedUntil - now);

                    if (bucket.Requests.Count >= rule.PermitLimit)
                    {
                        var nextAvailable = bucket.Requests.Peek() + rule.Window - now;
                        delay = Max(delay, nextAvailable);
                    }
                }

                if (delay <= TimeSpan.Zero)
                {
                    foreach (var rule in normalizedRules)
                        GetBucket(providerKey, rule.Bucket).Requests.Enqueue(now);
                    return;
                }
            }

            await Task.Delay(delay, cancellationToken);
        }
    }

    public void Observe(
        string providerKey,
        IReadOnlyList<ProviderRateLimitRule> rules,
        HttpResponseMessage response)
    {
        if (response.StatusCode != HttpStatusCode.TooManyRequests) return;

        var delay = GetServerDelay(response);
        if (delay <= TimeSpan.Zero) return;

        var blockedUntil = timeProvider.GetUtcNow() + delay;
        lock (sync)
        {
            foreach (var rule in NormalizeRules(rules))
            {
                var bucket = GetBucket(providerKey, rule.Bucket);
                if (blockedUntil > bucket.BlockedUntil)
                    bucket.BlockedUntil = blockedUntil;
            }
        }
    }

    private BucketState GetBucket(string providerKey, string bucket)
    {
        var key = $"{providerKey}:{bucket}";
        if (!buckets.TryGetValue(key, out var state))
        {
            state = new BucketState();
            buckets[key] = state;
        }

        return state;
    }

    private static List<ProviderRateLimitRule> NormalizeRules(
        IReadOnlyList<ProviderRateLimitRule> rules) =>
        rules
            .Where(rule => rule is not null)
            .GroupBy(rule => rule.Bucket, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

    private static TimeSpan GetServerDelay(HttpResponseMessage response)
    {
        if (response.Headers.RetryAfter is { } retryAfter)
        {
            if (retryAfter.Delta is { } delta)
                return LimitServerDelay(delta);
            if (retryAfter.Date is { } date)
                return LimitServerDelay(date - DateTimeOffset.UtcNow);
        }

        foreach (var headerName in new[] { "x-ratelimit-reset", "x-ratelimit-account-reset" })
        {
            if (!response.Headers.TryGetValues(headerName, out var values) ||
                !long.TryParse(values.FirstOrDefault(), out var resetValue))
                continue;

            // Trading 212 returns a Unix timestamp; SnapTrade returns seconds.
            var delay = resetValue > 1_000_000_000
                ? DateTimeOffset.FromUnixTimeSeconds(resetValue) - DateTimeOffset.UtcNow
                : TimeSpan.FromSeconds(resetValue);
            return LimitServerDelay(delay);
        }

        return TimeSpan.Zero;
    }

    private static TimeSpan LimitServerDelay(TimeSpan delay) =>
        delay <= TimeSpan.Zero
            ? TimeSpan.Zero
            : delay > MaximumServerDelay
                ? MaximumServerDelay
                : delay;

    private static TimeSpan Max(TimeSpan first, TimeSpan second) =>
        second > first ? second : first;

    private sealed class BucketState
    {
        public Queue<DateTimeOffset> Requests { get; } = new();
        public DateTimeOffset BlockedUntil { get; set; }

        public void RemoveExpired(DateTimeOffset now, TimeSpan window)
        {
            while (Requests.Count > 0 && Requests.Peek() + window <= now)
                Requests.Dequeue();
        }
    }
}

internal sealed class NoOpProviderRateLimiter : IProviderRateLimiter
{
    public Task WaitAsync(
        string providerKey,
        IReadOnlyList<ProviderRateLimitRule> rules,
        CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public void Observe(
        string providerKey,
        IReadOnlyList<ProviderRateLimitRule> rules,
        HttpResponseMessage response)
    {
    }
}
