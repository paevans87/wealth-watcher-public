using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

/// <summary>
/// Versioned budget metadata. The document is stored as JSON so new group and
/// category metadata can be added without changing the compatibility tables.
/// </summary>
public sealed class BudgetV2Document
{
    public int? Version { get; set; }
    public bool? NeedsUpdate { get; set; }
    public List<BudgetV2GroupDocument>? Groups { get; set; }
}

public sealed class BudgetV2GroupDocument
{
    public string? Id { get; set; }
    public string? Name { get; set; }
    public string? Kind { get; set; }
    public string? Role { get; set; }
    public bool? BuiltIn { get; set; }
    public List<BudgetV2ItemDocument>? Items { get; set; }
}

public sealed class BudgetV2ItemDocument
{
    public string? Id { get; set; }
    public string? Name { get; set; }
    public decimal Amount { get; set; }
    public string? Cadence { get; set; }

    private Guid? assetId;

    /// <summary>
    /// Tracks whether the caller explicitly supplied assetId. That lets a v2
    /// update preserve an existing mapping when the property is omitted while
    /// still allowing assetId: null to clear it.
    /// </summary>
    [JsonPropertyName("assetId")]
    public Guid? AssetId
    {
        get => assetId;
        set
        {
            assetId = value;
            AssetIdSpecified = true;
        }
    }

    [JsonIgnore]
    public bool AssetIdSpecified { get; private set; }

    public string? Category { get; set; }
}
