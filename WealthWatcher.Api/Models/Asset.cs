using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

/// <summary>
/// A single user-tracked asset, such as a house with equity or a bank account.
/// </summary>
public class Asset
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DisplayName { get; set; } = string.Empty;
    public Guid? AssetGroupId { get; set; }
    public bool AssetGroupAssignmentSet { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ArchivedAt { get; set; }

    [JsonIgnore]
    public ICollection<AssetKindAssignment> AssetKindAssignments { get; set; } = new List<AssetKindAssignment>();

    [JsonIgnore]
    public AssetGroup? AssetGroup { get; set; }

    [JsonIgnore]
    public ICollection<AssetValueEntry> ValueEntries { get; set; } = new List<AssetValueEntry>();

    [JsonIgnore]
    public ICollection<IntegrationAccountAssetMapping> IntegrationAccountMappings { get; set; } =
        new List<IntegrationAccountAssetMapping>();

    [JsonIgnore]
    public ICollection<ExternalValueAssetMapping> ExternalValueMappings { get; set; } =
        new List<ExternalValueAssetMapping>();

    [JsonIgnore]
    public PropertyDetail? PropertyDetail { get; set; }
}

/// <summary>
/// Compatibility name retained for callers compiled against the pre-refactor model.
/// It is not a separate database entity.
/// </summary>
[Obsolete("Use Asset.")]
public class AssetDefinition : Asset
{
}

public static class AssetValueShape
{
    public const string Cash = "Cash";
    public const string Investment = "Investment";
    public const string Property = "Property";
}

/// <summary>
/// Compatibility constants for the existing API payloads. AssetKind is the
/// business classification; this value only describes the value payload shape.
/// </summary>
public static class AssetEntryKind
{
    public const string Cash = AssetValueShape.Cash;
    public const string Investment = AssetValueShape.Investment;
    public const string Property = AssetValueShape.Property;
}
