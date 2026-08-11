using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WealthWatcher.Api.Caching;

public static class CacheTags
{
    public const string Wealth = "wealth";
    public const string WealthCurrent = "wealth-current";
    public const string Catalogue = "catalogue";
}

public static class CacheDurations
{
    // Historical aggregates are keyed by their as-of date and are invalidated by wealth writes.
    // The longer TTL is a safety net rather than the freshness mechanism for current-day data.
    public static readonly TimeSpan HistoricalAggregate = TimeSpan.FromDays(7);
    public static readonly TimeSpan Catalogue = TimeSpan.FromMinutes(30);
}

public static class CacheKeys
{
    public static string WealthAggregate(string category, string? period, string? timeZone, DateOnly asOfDate) =>
        $"wealth:aggregate:{Normalize(category)}:{Normalize(period ?? "default")}:{Normalize(timeZone ?? "default")}:{asOfDate:yyyy-MM-dd}";

    public static string Forecast(object request, DateOnly today)
    {
        var payload = JsonSerializer.Serialize(request);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        return $"wealth:forecast:{today:yyyy-MM-dd}:{hash}";
    }

    public static string HistoricalAggregates(string? period, string? timeZone, DateOnly asOfDate) =>
        $"wealth:read-model:{Normalize(period ?? "MAX")}:{Normalize(timeZone ?? "default")}:{asOfDate:yyyy-MM-dd}";

    public static string Calendar(int year, int month, DateOnly asOfDate) =>
        $"wealth:calendar:{year:0000}-{month:00}:{asOfDate:yyyy-MM-dd}";

    public static string Dashboard(string? period, string? timeZone, DateOnly asOfDate) =>
        $"wealth:dashboard:{Normalize(period ?? "1M")}:{Normalize(timeZone ?? "default")}:{asOfDate:yyyy-MM-dd}";

    public static string History(string? period, string? timeZone, DateOnly asOfDate) =>
        $"wealth:history:{Normalize(period ?? "1M")}:{Normalize(timeZone ?? "default")}:{asOfDate:yyyy-MM-dd}";

    private static string Normalize(string value) =>
        value.Trim().ToLowerInvariant().Replace(':', '_');
}

public interface IWealthCacheInvalidator
{
    Task InvalidateWealthAsync(CancellationToken cancellationToken = default);

    Task InvalidateCurrentWealthAsync(CancellationToken cancellationToken = default);

    Task InvalidateCatalogueAsync(CancellationToken cancellationToken = default);
}

public sealed class WealthCacheInvalidator(IApplicationCache cache) : IWealthCacheInvalidator
{
    public Task InvalidateWealthAsync(CancellationToken cancellationToken = default) =>
        cache.RemoveByTagAsync(CacheTags.Wealth, cancellationToken);

    public Task InvalidateCurrentWealthAsync(CancellationToken cancellationToken = default) =>
        cache.RemoveByTagAsync(CacheTags.WealthCurrent, cancellationToken);

    public Task InvalidateCatalogueAsync(CancellationToken cancellationToken = default) =>
        cache.RemoveByTagAsync(CacheTags.Catalogue, cancellationToken);
}
