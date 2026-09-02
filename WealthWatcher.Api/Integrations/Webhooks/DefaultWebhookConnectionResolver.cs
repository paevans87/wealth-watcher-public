using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using WealthWatcher.Api.Data;

namespace WealthWatcher.Api.Integrations.Webhooks;

/// <summary>
/// Resolves provider events using the provider-neutral account identifier carried
/// by common webhook contracts.
/// </summary>
public sealed class DefaultWebhookConnectionResolver : IWebhookConnectionResolver
{
    private static readonly string[] AccountIdentifierFields =
    [
        "accountId",
        "account_id",
        "externalAccountId",
        "external_account_id"
    ];

    public bool CanResolve(string providerKey) => true;

    public async Task<IReadOnlyList<Guid>> ResolveAsync(
        WebhookEnvelope envelope,
        WealthDbContext db,
        CancellationToken cancellationToken = default)
    {
        var accountIds = ReadStrings(envelope.Payload, AccountIdentifierFields);
        if (accountIds.Count == 0)
            return [];

        var provider = envelope.Provider.Trim();
        return await db.IntegrationAccounts
            .Where(account => accountIds.Contains(account.ExternalId) &&
                              account.IntegrationConnection!.IntegrationProvider!.Code == provider)
            .Select(account => account.IntegrationConnectionId)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    private static IReadOnlyList<string> ReadStrings(
        JsonElement payload,
        IReadOnlyCollection<string> names)
    {
        if (payload.ValueKind != JsonValueKind.Object)
            return [];

        var nameSet = names.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return payload.EnumerateObject()
            .Where(property => nameSet.Contains(property.Name) &&
                               property.Value.ValueKind == JsonValueKind.String)
            .Select(property => property.Value.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }
}
