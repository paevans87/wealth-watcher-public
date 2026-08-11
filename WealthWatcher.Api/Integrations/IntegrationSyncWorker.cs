namespace WealthWatcher.Api.Integrations;

public sealed class IntegrationSyncWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<IntegrationSyncWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<IntegrationService>();
                var results = await service.SyncEnabledAsync(cancellationToken: stoppingToken);
                if (results.Count > 0)
                {
                    logger.LogInformation(
                        "Integration polling completed for {Count} connection(s).",
                        results.Count);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Integration polling cycle failed.");
            }
        }
    }
}
