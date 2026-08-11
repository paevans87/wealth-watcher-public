using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Database;
using WealthWatcher.Api.Integrations;
using WealthWatcher.Api.Services;

namespace WealthWatcher.Api.Extensions;

public static class DataExtensions
{
    public static IServiceCollection AddWealthData(this IServiceCollection services, IConfiguration configuration, IWebHostEnvironment env)
    {
        if (env.IsDevelopment())
        {
            services.AddDbContext<WealthDbContext>(options =>
                options.UseInMemoryDatabase("WealthWatcherLocal"));
        }
        else
        {
            services.AddDbContext<WealthDbContext>(options =>
                options.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));
        }

        return services;
    }

    public static WebApplication InitializeDatabase(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();

        if (db.Database.IsRelational())
        {
            if (LegacySchemaBridge.IsRequired(db))
            {
                app.Logger.LogInformation("Detected the legacy Wealth Watcher schema; applying the data-preserving schema bridge before EF migrations.");
                LegacySchemaBridge.Apply(db);
            }

            db.Database.Migrate();
        }
        else
        {
            db.Database.EnsureCreated();
        }

        AssetCatalogService.EnsureDefaults(db);
        var registry = scope.ServiceProvider.GetService<IntegrationRegistry>();
        if (registry is not null)
            IntegrationCatalogService.EnsureProviders(db, registry);

        return app;
    }
}
