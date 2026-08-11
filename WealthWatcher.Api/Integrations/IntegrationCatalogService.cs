using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Integrations;

public static class IntegrationCatalogService
{
    public static void EnsureProviders(
        WealthDbContext db,
        IntegrationRegistry registry)
    {
        var changed = false;
        foreach (var adapter in registry.All)
        {
            var provider = db.IntegrationProviders
                .Local
                .FirstOrDefault(candidate => candidate.Code.Equals(adapter.Key, StringComparison.OrdinalIgnoreCase))
                ?? db.IntegrationProviders
                    .FirstOrDefault(candidate => candidate.Code.ToLower() == adapter.Key.ToLower());

            if (provider is null)
            {
                db.IntegrationProviders.Add(new IntegrationProvider
                {
                    Code = adapter.Key,
                    DisplayName = adapter.Descriptor.DisplayName
                });
                changed = true;
            }
            else if (provider.DisplayName != adapter.Descriptor.DisplayName)
            {
                provider.DisplayName = adapter.Descriptor.DisplayName;
                changed = true;
            }
        }

        if (changed)
            db.SaveChanges();
    }

    public static async Task<IntegrationProvider> EnsureProviderAsync(
        WealthDbContext db,
        IIntegrationAdapter adapter,
        CancellationToken cancellationToken = default)
    {
        var provider = await db.IntegrationProviders
            .FirstOrDefaultAsync(candidate => candidate.Code.ToLower() == adapter.Key.ToLower(), cancellationToken);
        if (provider is not null)
            return provider;

        provider = new IntegrationProvider
        {
            Code = adapter.Key,
            DisplayName = adapter.Descriptor.DisplayName
        };
        db.IntegrationProviders.Add(provider);
        await db.SaveChangesAsync(cancellationToken);
        return provider;
    }
}
