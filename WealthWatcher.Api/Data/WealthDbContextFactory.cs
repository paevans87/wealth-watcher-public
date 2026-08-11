using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WealthWatcher.Api.Data;

public sealed class WealthDbContextFactory : IDesignTimeDbContextFactory<WealthDbContext>
{
    public WealthDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<WealthDbContext>()
            .UseNpgsql("Host=localhost;Database=wealth_watcher_design;Username=postgres;Password=postgres")
            .Options;
        return new WealthDbContext(options);
    }
}
