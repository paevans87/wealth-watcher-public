using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Integrations;

namespace WealthWatcher.Api.Integrations.Webhooks;

/// <summary>
/// Adds SnapTrade's user/client identity fallback for lifecycle events that do
/// not include an account identifier. Account identifiers remain the preferred
/// mapping because they identify the configured local account directly.
/// </summary>
public sealed class SnaptradeWebhookConnectionResolver(
    IIntegrationCredentialProtector credentialProtector) : IWebhookConnectionResolver
{
    public int Priority => 100;

    public bool CanResolve(string providerKey) =>
        string.Equals(providerKey, SnaptradeIntegrationAdapter.ProviderKey, StringComparison.OrdinalIgnoreCase);

    public async Task<IReadOnlyList<Guid>> ResolveAsync(
        WebhookEnvelope envelope,
        WealthDbContext db,
        CancellationToken cancellationToken = default)
    {
        var accountMatches = await new DefaultWebhookConnectionResolver()
            .ResolveAsync(envelope, db, cancellationToken);
        if (accountMatches.Count > 0)
            return accountMatches;

        if (envelope.Payload.ValueKind != JsonValueKind.Object)
            return [];

        var userId = ReadString(envelope.Payload, "userId");
        var clientId = ReadString(envelope.Payload, "clientId");
        if (string.IsNullOrWhiteSpace(userId) && string.IsNullOrWhiteSpace(clientId))
            return [];

        var connections = await db.IntegrationConnections
            .Include(connection => connection.IntegrationProvider)
            .Where(connection => connection.IntegrationProvider!.Code == SnaptradeIntegrationAdapter.ProviderKey)
            .ToListAsync(cancellationToken);

        var matches = new List<Guid>();
        foreach (var connection in connections)
        {
            IReadOnlyDictionary<string, string> credentials;
            try
            {
                credentials = credentialProtector.Unprotect(connection.CredentialsCiphertext);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // A corrupted or rotated key should not prevent other configured
                // connections from being considered, and credentials are never logged.
                continue;
            }

            var configuredUserId = credentials
                .Where(pair => string.Equals(pair.Key, "userId", StringComparison.OrdinalIgnoreCase))
                .Select(pair => pair.Value)
                .FirstOrDefault();
            var hasConfiguredUserId = !string.IsNullOrWhiteSpace(configuredUserId);
            var userMatches = string.IsNullOrWhiteSpace(userId) ||
                              !hasConfiguredUserId ||
                              string.Equals(configuredUserId, userId, StringComparison.Ordinal);
            var clientMatches = string.IsNullOrWhiteSpace(clientId) ||
                                CredentialEquals(credentials, "clientId", clientId);
            if (userMatches && clientMatches)
                matches.Add(connection.Id);
        }

        // A client id can be shared by several local named connections. Do not
        // fan a lifecycle event out ambiguously when SnapTrade did not provide
        // its user identity.
        return matches.Count != 1
            ? []
            : matches;
    }

    private static string? ReadString(JsonElement payload, string name) =>
        payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool CredentialEquals(
        IReadOnlyDictionary<string, string> credentials,
        string key,
        string expected) =>
        credentials.Any(pair =>
            string.Equals(pair.Key, key, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(pair.Value, expected, StringComparison.Ordinal));
}
