using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WealthWatcher.Api.Data;

namespace WealthWatcher.Api.Integrations.Webhooks;

/// <summary>
/// Holds the user-facing relay switch and wakes the relay worker when it changes.
/// The deployment flag remains the hard availability boundary.
/// </summary>
public sealed class WebhookRelayControl(IOptions<WebhookRelayOptions> options)
{
    private readonly bool deploymentEnabled = options.Value.Enabled;
    private readonly object sync = new();
    private bool enabled = options.Value.Enabled;
    private TaskCompletionSource<bool> changeSignal = CreateSignal();

    public bool DeploymentEnabled => deploymentEnabled;

    public bool Enabled
    {
        get
        {
            lock (sync)
                return deploymentEnabled && enabled;
        }
    }

    public void LoadPersistedState(WealthDbContext db)
    {
        if (!deploymentEnabled)
        {
            SetEnabled(false);
            return;
        }

        var persisted = db.AppPreferences
            .AsNoTracking()
            .Where(preference => preference.Id == 1)
            .Select(preference => preference.WebhookRelayEnabled)
            .SingleOrDefault();
        SetEnabled(persisted ?? deploymentEnabled);
    }

    public async Task LoadPersistedStateAsync(
        IServiceScopeFactory scopeFactory,
        CancellationToken cancellationToken = default)
    {
        if (!deploymentEnabled)
        {
            SetEnabled(false);
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WealthDbContext>();
        var persisted = await db.AppPreferences
            .AsNoTracking()
            .Where(preference => preference.Id == 1)
            .Select(preference => preference.WebhookRelayEnabled)
            .SingleOrDefaultAsync(cancellationToken);
        SetEnabled(persisted ?? deploymentEnabled);
    }

    public void SetEnabled(bool requested)
    {
        var next = deploymentEnabled && requested;
        TaskCompletionSource<bool>? signalToRelease = null;
        lock (sync)
        {
            if (enabled == next)
                return;

            enabled = next;
            signalToRelease = changeSignal;
            changeSignal = CreateSignal();
        }

        signalToRelease.TrySetResult(true);
    }

    public Task WaitForChangeAsync(CancellationToken cancellationToken = default)
    {
        lock (sync)
            return changeSignal.Task.WaitAsync(cancellationToken);
    }

    public async Task WaitUntilEnabledAsync(CancellationToken cancellationToken = default)
    {
        while (!Enabled)
            await WaitForChangeAsync(cancellationToken);
    }

    private static TaskCompletionSource<bool> CreateSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);
}
