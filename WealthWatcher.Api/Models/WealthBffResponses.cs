namespace WealthWatcher.Api.Models;

public sealed class WealthBffCategoryResponse
{
    public string Id { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public string Color { get; init; } = string.Empty;
    public int DisplayOrder { get; init; }
    public Guid? AssetGroupId { get; init; }
    public string? AssetGroupCode { get; init; }
    public Guid ClassificationValueId { get; init; }
    public WealthAggregateResponse Aggregate { get; init; } = new();
}

public class WealthBffHistoryResponse
{
    public string? Period { get; init; }
    public List<WealthBffCategoryResponse> Categories { get; init; } = new();
    public List<WealthBffTimelinePoint> Timeline { get; init; } = new();
}

public sealed class WealthBffTimelinePoint
{
    public string Time { get; init; } = string.Empty;
    public decimal Value { get; init; }
}

public sealed class WealthBffDashboardResponse : WealthBffHistoryResponse
{
    public List<WealthBffCategoryResponse> YtdCategories { get; init; } = new();
    public decimal CurrentTotal { get; init; }
    public decimal PreviousTotal { get; init; }
    public decimal YtdStartTotal { get; init; }
    public List<WealthBffContributor> Contributors { get; init; } = new();
    public WealthBffTrackerResponse? Tracker { get; init; }
}

public sealed class WealthBffContributor
{
    public string Name { get; init; } = string.Empty;
    public string Color { get; init; } = string.Empty;
    public decimal CurrentValue { get; init; }
    public decimal Delta { get; init; }
    public decimal DeltaInvested { get; init; }
}

public sealed class WealthBffTrackerResponse
{
    public decimal TargetNumber { get; init; }
    public decimal InvestableAssets { get; init; }
    public decimal Remaining { get; init; }
    public decimal CompletionPercentage { get; init; }
    public decimal CurrentPassiveIncome { get; init; }
    public decimal TargetIncome { get; init; }
    public decimal Swr { get; init; }
    public bool IncludesStatePension { get; init; }
}

public sealed class WealthBffCalendarResponse
{
    public int Year { get; init; }
    public int Month { get; init; }
    public string Today { get; init; } = string.Empty;
    public string? EarliestHistoryDate { get; init; }
    public List<WealthBffCalendarDay> Days { get; init; } = new();
    public WealthBffMonthComparison MonthComparison { get; init; } = new();
}

public sealed class WealthBffCalendarDay
{
    public string Date { get; init; } = string.Empty;
    public decimal? Total { get; init; }
    public bool HasObservation { get; init; }
    public bool IsFuture { get; init; }
    public bool ChangeAvailable { get; init; }
    public decimal? Change { get; init; }
    public decimal? Percentage { get; init; }
}

public sealed class WealthBffMonthComparison
{
    public bool Available { get; init; }
    public string? CurrentDate { get; init; }
    public decimal? CurrentTotal { get; init; }
    public string? PreviousDate { get; init; }
    public decimal? PreviousTotal { get; init; }
    public decimal? Change { get; init; }
    public decimal? Percentage { get; init; }
}
