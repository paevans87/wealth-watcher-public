using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

/// <summary>
/// An account discovered through an IntegrationConnection.
/// </summary>
public sealed class IntegrationAccount
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid IntegrationConnectionId { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string AccountType { get; set; } = string.Empty;
    public string Currency { get; set; } = string.Empty;
    public IntegrationAccountStatus Status { get; set; } = IntegrationAccountStatus.Discovered;
    public DateTimeOffset LastSeenAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public IntegrationConnection? IntegrationConnection { get; set; }

    [JsonIgnore]
    public ICollection<IntegrationAccountAssetMapping> AssetMappings { get; set; } =
        new List<IntegrationAccountAssetMapping>();

    [JsonIgnore]
    public ICollection<ExternalValue> ExternalValues { get; set; } = new List<ExternalValue>();
}

public enum IntegrationAccountStatus
{
    Discovered = 1,
    Allocated = 2,
    Missing = 3
}

/// <summary>
/// User mapping from an IntegrationAccount to a local Asset.
/// </summary>
public sealed class IntegrationAccountAssetMapping
{
    public Guid IntegrationAccountId { get; set; }
    public ExternalValueRole Role { get; set; } = ExternalValueRole.Deployed;
    public Guid AssetId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public IntegrationAccount? IntegrationAccount { get; set; }

    [JsonIgnore]
    public Asset? Asset { get; set; }
}
