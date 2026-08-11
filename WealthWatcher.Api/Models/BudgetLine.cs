using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

public enum BudgetLineCategory
{
    Income = 1,
    Bills = 2,
    Savings = 3,
    Spend = 4
}

public enum BudgetCadence
{
    Monthly = 1,
    Quarterly = 2,
    Annually = 3
}

public class BudgetLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public BudgetLineCategory Category { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public BudgetCadence Cadence { get; set; } = BudgetCadence.Monthly;

    [JsonIgnore]
    public ICollection<BudgetLineAssetMapping> AssetMappings { get; set; } =
        new List<BudgetLineAssetMapping>();
}

public class BudgetLineAssetMapping
{
    public Guid BudgetLineId { get; set; }
    public Guid AssetId { get; set; }

    [JsonIgnore]
    public BudgetLine? BudgetLine { get; set; }

    [JsonIgnore]
    public Asset? Asset { get; set; }
}
