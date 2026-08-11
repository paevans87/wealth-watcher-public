using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

public enum ExternalValueRole
{
    Deployed = 1,
    Undeployed = 2,
    Other = 3
}

/// <summary>
/// A provider-owned value within one IntegrationAccount. The external key is
/// retained only as scoped boundary data.
/// </summary>
public class ExternalValue
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid IntegrationAccountId { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public ExternalValueRole Role { get; set; } = ExternalValueRole.Other;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }

    [JsonIgnore]
    public IntegrationAccount? IntegrationAccount { get; set; }

    [JsonIgnore]
    public ICollection<ExternalValueAssetMapping> AssetMappings { get; set; } =
        new List<ExternalValueAssetMapping>();

    [JsonIgnore]
    public ICollection<AssetValueEntrySource> EntrySources { get; set; } =
        new List<AssetValueEntrySource>();
}

/// <summary>
/// Current mapping from a provider-owned value to a local Asset.
/// </summary>
public class ExternalValueAssetMapping
{
    public Guid ExternalValueId { get; set; }
    public Guid AssetId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public ExternalValue? ExternalValue { get; set; }

    [JsonIgnore]
    public Asset? Asset { get; set; }
}

/// <summary>
/// Compatibility DTO/entity vocabulary for pre-refactor callers. It is not
/// included in the EF model; use ExternalValue instead.
/// </summary>
[Obsolete("Use ExternalValue.")]
public class ProviderAssetLink
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? IntegrationConnectionId { get; set; }
    public string ProviderKey { get; set; } = string.Empty;
    public string ExternalAssetId { get; set; } = string.Empty;
    public Guid AssetId { get; set; }
    public string ExternalName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }
}
