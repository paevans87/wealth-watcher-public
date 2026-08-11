using WealthWatcher.Api.Caching;

namespace WealthWatcher.Api.Extensions;

public static class CachingExtensions
{
    public static IServiceCollection AddWealthCaching(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddSingleton<IApplicationCache, InMemoryApplicationCache>();
        services.AddSingleton<IWealthCacheInvalidator, WealthCacheInvalidator>();
        return services;
    }
}
