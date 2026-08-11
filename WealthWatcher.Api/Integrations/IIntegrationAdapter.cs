using System.Text.Json;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Integrations;

public interface IIntegrationAdapter
{
    string Key { get; }
    IntegrationDescriptor Descriptor { get; }

    Task<IntegrationTestResult> TestAsync(
        IntegrationContext context,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ExternalAccount>> DiscoverAccountsAsync(
        IntegrationContext context,
        CancellationToken cancellationToken);

    Task<IntegrationPullResult> PullAsync(
        IntegrationContext context,
        IReadOnlyCollection<ExternalAccount> accounts,
        CancellationToken cancellationToken);
}

public sealed class IntegrationContext
{
    public required string ProviderKey { get; init; }
    public required Guid ConnectionId { get; init; }
    public required string DisplayName { get; init; }
    public required IReadOnlyDictionary<string, string> Credentials { get; init; }
    public required JsonElement Options { get; init; }
}

public sealed class IntegrationDescriptor
{
    public string Key { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public IntegrationKind Kind { get; init; } = IntegrationKind.Investment;
    public int DefaultPollingIntervalMinutes { get; init; } = 180;
    public int MinimumPollingIntervalMinutes { get; init; } = 1;
    public IReadOnlyList<IntegrationFieldDescriptor> CredentialFields { get; init; } = [];
    public IReadOnlyList<IntegrationFieldDescriptor> OptionFields { get; init; } = [];
}

public sealed class IntegrationFieldDescriptor
{
    public string Key { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Type { get; init; } = "text";
    public bool Required { get; init; }
    public bool Secret { get; init; }
    public string? DefaultValue { get; init; }
    public IReadOnlyList<IntegrationFieldOption> Options { get; init; } = [];
}

public sealed class IntegrationFieldOption
{
    public string Value { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
}

public sealed class IntegrationTestResult
{
    public bool Succeeded { get; init; }
    public string Message { get; init; } = string.Empty;
    public IReadOnlyList<ExternalAccount> Accounts { get; init; } = [];
}

public sealed class ExternalAccount
{
    public string ExternalId { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public string AccountType { get; init; } = string.Empty;
    public string Currency { get; init; } = string.Empty;
}

public sealed class IntegrationPullResult
{
    public List<ExternalValueSnapshot> Values { get; init; } = [];
    public List<string> Errors { get; init; } = [];
    public List<string> Summaries { get; init; } = [];
}

public sealed class ExternalValueSnapshot
{
    public string AccountExternalId { get; init; } = string.Empty;
    public string ExternalValueId { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? NameSuffix { get; init; }
    public ExternalValueRole Role { get; init; } = ExternalValueRole.Other;
    public string Type { get; init; } = string.Empty;
    public decimal Value { get; init; }
    public decimal? InvestedCapital { get; init; }
    public DateTimeOffset ObservedAt { get; init; } = DateTimeOffset.UtcNow;
    public List<ExternalPosition> Positions { get; init; } = [];
}

public sealed class ExternalPosition
{
    public string Ticker { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public decimal Quantity { get; init; }
    public decimal AveragePrice { get; init; }
    public decimal CurrentPrice { get; init; }
    public decimal CurrentValue { get; init; }
}
