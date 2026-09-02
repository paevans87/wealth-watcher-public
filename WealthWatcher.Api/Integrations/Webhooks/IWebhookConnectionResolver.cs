using WealthWatcher.Api.Data;

namespace WealthWatcher.Api.Integrations.Webhooks;

public interface IWebhookConnectionResolver
{
    /// <summary>
    /// Gets the resolver precedence when several resolvers can handle a provider.
    /// </summary>
    int Priority => 0;

    bool CanResolve(string providerKey);

    Task<IReadOnlyList<Guid>> ResolveAsync(
        WebhookEnvelope envelope,
        WealthDbContext db,
        CancellationToken cancellationToken = default);
}
