using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

/// <summary>
/// A type description of assets, such as Cash, Properties, or Pensions.
/// </summary>
public class AssetKind
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public string ValueShape { get; set; } = AssetValueShape.Cash;
    public DateTimeOffset? ArchivedAt { get; set; }

    [JsonIgnore]
    public ICollection<AssetKindAssignment> AssetAssignments { get; set; } =
        new List<AssetKindAssignment>();

    [JsonIgnore]
    public ICollection<AssetKindGroup> GroupMappings { get; set; } = new List<AssetKindGroup>();
}

/// <summary>
/// A second-level grouping of asset kinds, such as Liquid or Illiquid.
/// </summary>
public class AssetGroup
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public bool IsSystem { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }

    [JsonIgnore]
    public ICollection<AssetKindGroup> KindMappings { get; set; } = new List<AssetKindGroup>();
}

/// <summary>
/// Join table between an AssetKind and its optional AssetGroup.
/// </summary>
public class AssetKindGroup
{
    public Guid AssetKindId { get; set; }
    public Guid AssetGroupId { get; set; }

    [JsonIgnore]
    public AssetKind? AssetKind { get; set; }

    [JsonIgnore]
    public AssetGroup? AssetGroup { get; set; }
}

/// <summary>
/// Join table assigning one or more asset kinds to an asset. The current
/// product rule is one active kind per asset and is enforced in the database.
/// </summary>
public class AssetKindAssignment
{
    public Guid AssetId { get; set; }
    public Guid AssetKindId { get; set; }

    [JsonIgnore]
    public Asset? Asset { get; set; }

    [JsonIgnore]
    public AssetKind? AssetKind { get; set; }
}

public static class AssetKindCodes
{
    public const string Cash = "cash";
    public const string Savings = "savings";
    public const string Investments = "investments";
    public const string Property = "property";
    public const string Pensions = "pensions";
    public const string Bonds = "bonds";
    public const string Unclassified = "unclassified";
}

public static class AssetGroupCodes
{
    public const string Liquid = "liquid";
    public const string Illiquid = "illiquid";
}

/// <summary>
/// Compatibility aliases for the old endpoint vocabulary. These are API
/// labels only; the database stores AssetKinds and AssetGroups separately.
/// </summary>
public static class AssetClassificationKeys
{
    public const string Assets = "asset-kind";
    public const string AssetClasses = "asset-group";
    public const string Liquid = AssetGroupCodes.Liquid;
    public const string Illiquid = AssetGroupCodes.Illiquid;
    public const string Unclassified = AssetKindCodes.Unclassified;
}
