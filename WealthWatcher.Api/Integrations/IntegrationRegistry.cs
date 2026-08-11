namespace WealthWatcher.Api.Integrations;

public sealed class IntegrationRegistry(IEnumerable<IIntegrationAdapter> adapters)
{
    private readonly IReadOnlyDictionary<string, IIntegrationAdapter> adapters =
        adapters.ToDictionary(adapter => adapter.Key, StringComparer.OrdinalIgnoreCase);

    public IReadOnlyCollection<IIntegrationAdapter> All => adapters.Values.ToArray();

    public IIntegrationAdapter Get(string providerKey) =>
        adapters.TryGetValue(providerKey, out var adapter)
            ? adapter
            : throw new KeyNotFoundException($"Integration '{providerKey}' is not available.");
}
