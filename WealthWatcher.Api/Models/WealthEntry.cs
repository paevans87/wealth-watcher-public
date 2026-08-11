using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

/// <summary>
/// A dated value observed for one Asset.
/// </summary>
public abstract class AssetValueEntry
{
    public int Id { get; set; }
    public Guid AssetId { get; set; }

    [JsonIgnore]
    public Asset? Asset { get; set; }

    /// <summary>
    /// A display snapshot retained for historical/provider labels. It is not an identifier.
    /// </summary>
    public string Name { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly Time { get; set; }

    [JsonIgnore]
    public AssetValueEntrySource? SourceLink { get; set; }

    /// <summary>
    /// Resolved from the AssetKind assignment before calculations. This is not persisted;
    /// the relationship lives in AssetKindAssignments.
    /// </summary>
    [NotMapped]
    public string AssetKindCode { get; set; } = string.Empty;

    // Compatibility aliases for older in-memory callers. These are deliberately
    // not mapped to the database; source identity now lives in SourceLink.
    [NotMapped]
    [Obsolete("Use AssetKindCode.")]
    public string Type
    {
        get => AssetKindCode;
        set => AssetKindCode = value;
    }

    [NotMapped]
    [Obsolete("Use AssetValueEntrySource.")]
    public string Source { get; set; } = "Manual";

    [NotMapped]
    [Obsolete("Use ExternalValue and AssetValueEntrySource.")]
    public string? ProviderKey { get; set; }

    [NotMapped]
    [Obsolete("Use ExternalValue and AssetValueEntrySource.")]
    public string? ExternalAssetId { get; set; }

    public DateTime DateTime => Date.ToDateTime(Time);

    protected AssetValueEntry()
    {
    }

    protected AssetValueEntry(
        string name,
        string assetKindCode,
        decimal value,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
    {
        Name = name;
        AssetKindCode = assetKindCode;
        Value = value;
        Date = date;
        Time = time;
        Source = source;
    }
}

/// <summary>
/// Compatibility base for older in-memory consumers. New code should use
/// AssetValueEntry directly.
/// </summary>
[Obsolete("Use AssetValueEntry.")]
public abstract class WealthEntry : AssetValueEntry
{
    protected WealthEntry()
    {
    }

    protected WealthEntry(
        string name,
        string assetKindCode,
        decimal value,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, date, time, source)
    {
    }
}

public class CashAssetValueEntry : WealthEntry
{
    public CashAssetValueEntry()
    {
    }

    public CashAssetValueEntry(
        string name,
        string assetKindCode,
        decimal value,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, date, time, source)
    {
    }
}

[Obsolete("Use CashAssetValueEntry.")]
public class CashEntry : CashAssetValueEntry
{
    public CashEntry()
    {
    }

    public CashEntry(
        string name,
        string assetKindCode,
        decimal value,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, date, time, source)
    {
    }
}

public class InvestmentAssetValueEntry : WealthEntry
{
    public decimal? InvestedCapital { get; set; }
    public List<PortfolioPosition> Positions { get; set; } = new();

    public InvestmentAssetValueEntry()
    {
    }

    public InvestmentAssetValueEntry(
        string name,
        string assetKindCode,
        decimal value,
        decimal? investedCapital,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, date, time, source)
    {
        InvestedCapital = investedCapital;
    }
}

[Obsolete("Use InvestmentAssetValueEntry.")]
public class InvestmentEntry : InvestmentAssetValueEntry
{
    public InvestmentEntry()
    {
    }

    public InvestmentEntry(
        string name,
        string assetKindCode,
        decimal value,
        decimal? investedCapital,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, investedCapital, date, time, source)
    {
    }
}

public class PropertyAssetValueEntry : WealthEntry
{
    public decimal? Mortgage { get; set; }

    public PropertyAssetValueEntry()
    {
    }

    public PropertyAssetValueEntry(
        string name,
        string assetKindCode,
        decimal value,
        decimal? mortgage,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, date, time, source)
    {
        Mortgage = mortgage;
    }
}

[Obsolete("Use PropertyAssetValueEntry.")]
public class PropertyEntry : PropertyAssetValueEntry
{
    public PropertyEntry()
    {
    }

    public PropertyEntry(
        string name,
        string assetKindCode,
        decimal value,
        decimal? mortgage,
        DateOnly date,
        TimeOnly time,
        string source = "Manual")
        : base(name, assetKindCode, value, mortgage, date, time, source)
    {
    }
}

public class PortfolioPosition
{
    public string Ticker { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal AveragePrice { get; set; }
    public decimal CurrentPrice { get; set; }
    public decimal CurrentValue { get; set; }
}
