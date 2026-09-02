using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Integrations.Webhooks;

public sealed class WebhookRelaySettingsService(
    WealthDbContext db,
    WebhookRelayControl control,
    IOptions<WebhookRelayOptions> options)
{
    public async Task SaveEnabledAsync(
        bool enabled,
        CancellationToken cancellationToken = default)
    {
        if (enabled && !options.Value.Enabled)
        {
            throw new ArgumentException(
                "The webhook relay is not available because it is disabled in the deployment configuration.");
        }

        var preference = await db.AppPreferences.FindAsync([1], cancellationToken);
        if (preference is null)
        {
            preference = new AppPreference();
            db.AppPreferences.Add(preference);
        }

        if (!enabled)
        {
            var webhookConnections = await db.IntegrationConnections
                .Where(connection => connection.SyncMode == IntegrationSyncMode.Webhook)
                .ToListAsync(cancellationToken);
            var updatedAt = DateTimeOffset.UtcNow;
            foreach (var connection in webhookConnections)
            {
                connection.SyncMode = IntegrationSyncMode.Polling;
                connection.UpdatedAt = updatedAt;
            }
        }

        preference.WebhookRelayEnabled = enabled;
        await db.SaveChangesAsync(cancellationToken);
        control.SetEnabled(enabled);
    }
}
