using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Extensions;

public static class ForecastCalculator
{
    public const string ContributionsStack = "Unallocated Contributions";
    public const string WindfallsStack = "Unallocated Windfalls";

    public const string FireDefaultStrategy = "fire-default";
    public const string CashFlowAdjustedCagrStrategy = "cash-flow-adjusted-cagr";
    public const string MedianMonthlyReturnStrategy = "median-monthly-return";
    public const string WeightedLogReturnStrategy = "weighted-log-return";
    public const string RegressionTrendStrategy = "regression-trend";
    public const string WinsorizedMonthlyReturnStrategy = "winsorized-monthly-return";
    public const string FirstLastAnnualizedStrategy = "first-last-annualized";

    public static readonly IReadOnlySet<string> HistoricalStrategies = new HashSet<string>(
        [CashFlowAdjustedCagrStrategy, MedianMonthlyReturnStrategy, WeightedLogReturnStrategy,
            RegressionTrendStrategy, WinsorizedMonthlyReturnStrategy, FirstLastAnnualizedStrategy],
        StringComparer.OrdinalIgnoreCase);

    public static ForecastResponse Calculate(IEnumerable<AssetValueEntry> source, ForecastRequest request, DateOnly today)
    {
        var included = request.IncludedAssets.Select(x => x.ToLowerInvariant()).ToHashSet();
        var entries = source.Where(e => included.Contains(e.AssetKindCode.ToLowerInvariant()))
            .OrderBy(e => e.Date).ThenBy(e => e.Time).ToList();
        if (entries.Count == 0) throw new InvalidOperationException("No included asset data");

        var strategy = NormalizeStrategy(request.ForecastStrategy);
        var contributionPlan = BuildContributionPlan(request);
        var assets = entries.GroupBy(e => (Type: e.AssetKindCode.ToLowerInvariant(), e.Name, e.AssetId))
            .Select(g => {
                var history = CalculateHistoricalRate(g, strategy, request.AnnualReturn, today);
                return new ProjectedAsset(g.Key.Type, g.Key.Name, g.Key.AssetId, GetNetValue(g.Last()),
                    history.AnnualRate, history.Source, history.IsCashFlowAdjusted, history.PeriodCount);
            })
            .Where(asset => asset.Value != 0 || contributionPlan.HasAllocation(asset.AssetId))
            .ToList();

        var contributionTargetKeys = assets
            .Where(asset => asset.AssetId.HasValue)
            .GroupBy(asset => asset.AssetId!.Value)
            .Select(group => group
                .OrderBy(asset => IsUndeployed(asset) ? 1 : 0)
                .ThenBy(asset => asset.Name, StringComparer.OrdinalIgnoreCase)
                .First()
                .Key)
            .ToHashSet(StringComparer.Ordinal);
        var order = request.IncludedAssets.Select(Label).Where(t => assets.Any(a => a.Type == t)).Distinct().ToList();
        order.Add(ContributionsStack);
        if (request.Windfalls.Any(w => w.IncludeInCalculation)) order.Add(WindfallsStack);

        var windfalls = request.Windfalls.Where(w => w.IncludeInCalculation && DateOnly.TryParse(w.ExpectedDate, out _))
            .Select(w => (Date: DateOnly.Parse(w.ExpectedDate), w.Amount)).ToList();
        var configuredAnnualRate = (double)request.AnnualReturn / 100;
        var projectionContributionRate = BlendedHistoricalRate(assets, configuredAnnualRate);
        var projectionValues = assets.ToDictionary(a => a.Key, a => (double)a.Value);
        var projectionDates = new SortedSet<DateOnly> { today };
        var date = new DateOnly(today.Year, today.Month, 1);
        double projectionContributions = 0;
        double windfallBalance = (double)windfalls.Where(w => w.Date <= today).Sum(w => w.Amount);
        var initial = assets.Sum(a => (double)a.Value) + windfallBalance;
        int targetHit = initial >= (double)request.Target ? 0 : -1;
        string? targetHitDate = targetHit == 0 ? today.ToString("yyyy-MM-dd") : null;

        for (var month = 1; month <= 1200; month++)
        {
            date = date.AddMonths(1);
            var unallocatedAddition = contributionPlan.UnallocatedForPeriod(month);
            projectionContributions = (projectionContributions + unallocatedAddition) *
                (1 + Monthly(projectionContributionRate));
            windfallBalance += (double)windfalls.Where(w => w.Date.Year == date.Year && w.Date.Month == date.Month).Sum(w => w.Amount);
            foreach (var asset in assets)
            {
                var addition = contributionTargetKeys.Contains(asset.Key)
                    ? contributionPlan.ForAssetPeriod(asset.AssetId, month)
                    : 0;
                projectionValues[asset.Key] = (projectionValues[asset.Key] + addition) *
                    (1 + Monthly(asset.Rate));
            }

            var reached = targetHit < 0 && projectionValues.Values.Sum() + projectionContributions + windfallBalance >= (double)request.Target;
            if (reached)
            {
                targetHit = month;
                targetHitDate = date.ToString("yyyy-MM-dd");
            }
            if ((targetHit < 0 && (date.Month == 1 || month == 1200)) || reached)
                projectionDates.Add(date);
            if (targetHit >= 0) break;
        }

        var projection = Build(assets, contributionPlan, projectionContributionRate,
            windfalls, today, projectionDates, order, contributionTargetKeys);
        var rateSources = assets.Select(a => new HistoricalRateSource {
            AssetName = a.Name, AssetType = a.Type, AnnualRatePercent = a.Rate * 100,
            Source = a.Source, IsCashFlowAdjusted = a.Adjusted,
            HistoricalPeriodCount = a.PeriodCount
        }).ToList();

        return new ForecastResponse {
            Projection = projection,
            StackOrder = order,
            RateSources = rateSources,
            SelectedStrategy = strategy,
            SelectedStrategyDescription = DescribeStrategy(strategy),
            TargetHitMonth = targetHit,
            TargetHitDate = targetHitDate,
            CurrentNW = (decimal)initial
        };
    }

    public static string NormalizeStrategy(string? strategy)
    {
        var normalized = (strategy ?? string.Empty).Trim().ToLowerInvariant();
        return normalized == FireDefaultStrategy || HistoricalStrategies.Contains(normalized)
            ? normalized
            : FireDefaultStrategy;
    }

    public static string DescribeStrategy(string strategy) => NormalizeStrategy(strategy) switch
    {
        FireDefaultStrategy => "Uses the configured FIRE/default annual return; historical data is not extrapolated.",
        CashFlowAdjustedCagrStrategy => "Links completed monthly returns after removing known invested-capital changes, then annualizes the compounded result.",
        MedianMonthlyReturnStrategy => "Annualizes the median completed-month return, reducing the influence of unusually strong or weak months.",
        WeightedLogReturnStrategy => "Averages monthly log returns with more weight on recent months, then annualizes the result.",
        RegressionTrendStrategy => "Fits a straight-line trend to cumulative cash-flow-adjusted log wealth; the slope is the annualized forecast rate.",
        WinsorizedMonthlyReturnStrategy => "Clamps extreme completed-month returns to the 10th/90th percentile before compounding, limiting outlier impact.",
        FirstLastAnnualizedStrategy => "Compares the first and last observed history values, annualizes the compounded change over the elapsed period, and applies that annual rate to the forecast.",
        _ => "Uses the configured FIRE/default annual return."
    };

    public static HistoricalRateResult CalculateHistoricalRate(
        IEnumerable<AssetValueEntry> source, string strategy, decimal fallbackPercent, DateOnly today)
    {
        var normalized = NormalizeStrategy(strategy);
        if (normalized == FireDefaultStrategy)
            return new((double)fallbackPercent / 100, FireDefaultStrategy, false, 0);

        if (normalized == FirstLastAnnualizedStrategy)
        {
            var points = BuildHistoricalPoints(source);
            if (points.Count < 2)
                return new((double)fallbackPercent / 100, "fallback", false, 0);

            var firstLastRate = AnnualizeFirstLast(points);
            if (!double.IsFinite(firstLastRate) || firstLastRate <= -1)
                return new((double)fallbackPercent / 100, "fallback", false, 0);

            var periodCount = points
                .Select(point => (point.Date.Year, point.Date.Month))
                .Distinct()
                .Count();
            return new(firstLastRate, normalized, false, periodCount);
        }

        var observations = BuildMonthlyObservations(source, today);
        if (observations.Count == 0)
            return new((double)fallbackPercent / 100, "fallback", false, 0);

        var factors = observations.Select(observation => observation.GrowthFactor).ToList();
        var annualRate = normalized switch
        {
            CashFlowAdjustedCagrStrategy => AnnualizeAverageLog(factors.Select(factor => Math.Log(factor))),
            MedianMonthlyReturnStrategy => AnnualizeSimpleReturn(Median(factors.Select(factor => factor - 1))),
            WeightedLogReturnStrategy => AnnualizeWeightedLog(factors),
            RegressionTrendStrategy => AnnualizeRegression(observations),
            WinsorizedMonthlyReturnStrategy => AnnualizeWinsorized(factors),
            _ => (double)fallbackPercent / 100
        };

        if (!double.IsFinite(annualRate) || annualRate <= -1)
            return new((double)fallbackPercent / 100, "fallback", false, 0);

        return new(annualRate, normalized, observations.All(observation => observation.IsCashFlowAdjusted), observations.Count);
    }

    private static List<MonthlyObservation> BuildMonthlyObservations(
        IEnumerable<AssetValueEntry> source, DateOnly today)
    {
        var cutoff = new DateOnly(today.Year, today.Month, 1);
        var points = BuildHistoricalPoints(source);
        var observations = new List<MonthlyObservation>();
        foreach (var month in points.Where(point => point.Date < cutoff).GroupBy(point => (point.Date.Year, point.Date.Month)))
        {
            var monthPoints = month.OrderBy(point => point.Date).ThenBy(point => point.Time).ToList();
            if (monthPoints.Count < 2 || !TryCalculateLinkedGrowth(monthPoints, out var linkedGrowth, out var adjusted))
                continue;

            var daysInMonth = DateTime.DaysInMonth(month.Key.Year, month.Key.Month);
            var observedDays = Math.Max(1d,
                monthPoints[^1].Date.DayOfYear - monthPoints[0].Date.DayOfYear + 1d);
            var growthFactor = Math.Pow(linkedGrowth, daysInMonth / observedDays);
            if (double.IsFinite(growthFactor) && growthFactor > 0)
                observations.Add(new(new DateOnly(month.Key.Year, month.Key.Month, 1), growthFactor, adjusted));
        }
        return observations.OrderBy(observation => observation.Month).ToList();
    }

    private static double AnnualizeAverageLog(IEnumerable<double> logs) =>
        Math.Exp(logs.Average() * 12) - 1;

    private static double AnnualizeFirstLast(IReadOnlyList<HistoricalPoint> points)
    {
        var first = points[0];
        var last = points[^1];
        if (first.Value <= 0 || last.Value <= 0) return double.NaN;

        var firstDate = first.Date.ToDateTime(first.Time);
        var lastDate = last.Date.ToDateTime(last.Time);
        var elapsedDays = (lastDate - firstDate).TotalDays;
        if (!double.IsFinite(elapsedDays) || elapsedDays <= 0) return double.NaN;

        // The first/last ratio is a total compounded return. Raising it to
        // the elapsed-years reciprocal produces the annual rate used by the
        // projection's monthly compounding path.
        return Math.Pow((double)(last.Value / first.Value), 365d / elapsedDays) - 1;
    }

    private static double AnnualizeSimpleReturn(double monthlyReturn) =>
        Math.Pow(1 + monthlyReturn, 12) - 1;

    private static double AnnualizeWeightedLog(IReadOnlyList<double> factors)
    {
        var totalWeight = factors.Count * (factors.Count + 1) / 2d;
        var weightedLog = factors.Select((factor, index) => (index + 1) * Math.Log(factor)).Sum() / totalWeight;
        return Math.Exp(weightedLog * 12) - 1;
    }

    private static double AnnualizeRegression(IReadOnlyList<MonthlyObservation> observations)
    {
        if (observations.Count == 1) return Math.Exp(Math.Log(observations[0].GrowthFactor) * 12) - 1;

        var cumulativeLogs = new double[observations.Count];
        for (var index = 0; index < observations.Count; index++)
            cumulativeLogs[index] = Math.Log(observations[index].GrowthFactor) + (index == 0 ? 0 : cumulativeLogs[index - 1]);

        var xMean = (observations.Count - 1) / 2d;
        var yMean = cumulativeLogs.Average();
        var denominator = Enumerable.Range(0, observations.Count)
            .Sum(index => Math.Pow(index - xMean, 2));
        var slope = Enumerable.Range(0, observations.Count)
            .Sum(index => (index - xMean) * (cumulativeLogs[index] - yMean)) / denominator;
        return Math.Exp(slope * 12) - 1;
    }

    private static double AnnualizeWinsorized(IReadOnlyList<double> factors)
    {
        var returns = factors.Select(factor => factor - 1).OrderBy(value => value).ToList();
        var lower = Quantile(returns, 0.10);
        var upper = Quantile(returns, 0.90);
        var averageLog = returns.Select(value => Math.Log(1 + Math.Clamp(value, lower, upper))).Average();
        return Math.Exp(averageLog * 12) - 1;
    }

    private static double Quantile(IReadOnlyList<double> values, double position)
    {
        if (values.Count == 1) return values[0];
        var index = position * (values.Count - 1);
        var lower = (int)Math.Floor(index);
        var upper = (int)Math.Ceiling(index);
        if (lower == upper) return values[lower];
        return values[lower] + (values[upper] - values[lower]) * (index - lower);
    }

    private static double Median(IEnumerable<double> values)
    {
        var ordered = values.OrderBy(value => value).ToList();
        var middle = ordered.Count / 2;
        return ordered.Count % 2 == 0
            ? (ordered[middle - 1] + ordered[middle]) / 2
            : ordered[middle];
    }

    private static List<ForecastPoint> Build(List<ProjectedAsset> assets, ContributionPlan contributionPlan,
        double contributionAnnualRate, List<(DateOnly Date, decimal Amount)> windfalls, DateOnly today,
        SortedSet<DateOnly> dates, List<string> order, HashSet<string> contributionTargetKeys)
    {
        var values = assets.ToDictionary(a => a.Key, a => (double)a.Value);
        var result = new List<ForecastPoint>();
        double contributions = 0;
        double windfallBalance = (double)windfalls.Where(w => w.Date <= today).Sum(w => w.Amount);
        Add(result, today, values, assets, contributions, windfallBalance, order);
        var date = new DateOnly(today.Year, today.Month, 1);
        var period = 0;
        while (date < dates.Max)
        {
            date = date.AddMonths(1);
            period++;
            contributions = (contributions + contributionPlan.UnallocatedForPeriod(period)) *
                (1 + Monthly(contributionAnnualRate));
            windfallBalance += (double)windfalls.Where(w => w.Date.Year == date.Year && w.Date.Month == date.Month).Sum(w => w.Amount);
            foreach (var asset in assets)
            {
                var addition = contributionTargetKeys.Contains(asset.Key)
                    ? contributionPlan.ForAssetPeriod(asset.AssetId, period)
                    : 0;
                values[asset.Key] = (values[asset.Key] + addition) * (1 + Monthly(asset.Rate));
            }
            if (dates.Contains(date)) Add(result, date, values, assets, contributions, windfallBalance, order);
        }
        return result;
    }

    private static List<HistoricalPoint> BuildHistoricalPoints(IEnumerable<AssetValueEntry> source) =>
        source
            .GroupBy(entry => (entry.Date, entry.Time))
            .OrderBy(group => group.Key.Date)
            .ThenBy(group => group.Key.Time)
            .Select(group =>
            {
                var entries = group.ToList();
                var isInvestment = entries.Any(entry => entry is InvestmentAssetValueEntry);
                var investedCapital = isInvestment && entries.All(entry =>
                    entry is InvestmentAssetValueEntry investment && investment.InvestedCapital.HasValue)
                    ? entries.Sum(entry => ((InvestmentAssetValueEntry)entry).InvestedCapital!.Value)
                    : (decimal?)null;
                return new HistoricalPoint(
                    group.Key.Date,
                    group.Key.Time,
                    entries.Sum(GetNetValue),
                    investedCapital,
                    isInvestment);
            })
            .ToList();

    private static bool TryCalculateLinkedGrowth(
        IReadOnlyList<HistoricalPoint> points, out double linkedGrowth, out bool adjusted)
    {
        linkedGrowth = 1;
        adjusted = points.Any(point => point.IsInvestment);
        if (points.Count < 2) return false;

        for (var index = 1; index < points.Count; index++)
        {
            var opening = points[index - 1];
            var closing = points[index];
            if (opening.Value <= 0 || closing.Value < 0) return false;

            decimal flow = 0;
            if (adjusted)
            {
                if (!opening.InvestedCapital.HasValue || !closing.InvestedCapital.HasValue)
                    return false;
                flow = closing.InvestedCapital.Value - opening.InvestedCapital.Value;
            }

            var growth = (double)((closing.Value - flow) / opening.Value);
            if (!double.IsFinite(growth) || growth <= 0) return false;
            linkedGrowth *= growth;
        }

        return double.IsFinite(linkedGrowth) && linkedGrowth > 0;
    }

    private static double BlendedHistoricalRate(List<ProjectedAsset> assets, double fallbackRate)
    {
        var valid = assets.Where(asset => double.IsFinite(asset.Rate)).ToList();
        if (valid.Count == 0) return fallbackRate;

        var weighted = valid.Where(asset => asset.Value > 0).ToList();
        if (weighted.Count == 0) return valid.Average(asset => asset.Rate);

        var total = weighted.Sum(asset => (double)asset.Value);
        return weighted.Sum(asset => (double)asset.Value * asset.Rate) / total;
    }

    private static ContributionPlan BuildContributionPlan(ForecastRequest request)
    {
        var allocated = new Dictionary<Guid, List<RecurringContribution>>();
        var unallocated = new List<RecurringContribution>();
        if (request.MonthlyContribution != 0)
            unallocated.Add(new(null, (double)request.MonthlyContribution, 1));

        foreach (var contribution in request.Contributions.Where(contribution => contribution.Amount > 0))
        {
            var recurring = new RecurringContribution(
                contribution.AssetId,
                (double)contribution.Amount,
                CadenceMonths(contribution.Cadence));
            if (contribution.AssetId is Guid assetId)
            {
                if (!allocated.TryGetValue(assetId, out var assetContributions))
                {
                    assetContributions = new List<RecurringContribution>();
                    allocated[assetId] = assetContributions;
                }
                assetContributions.Add(recurring);
            }
            else
            {
                unallocated.Add(recurring);
            }
        }

        return new ContributionPlan(allocated, unallocated);
    }

    private static int CadenceMonths(string? cadence)
    {
        var normalized = (cadence ?? string.Empty).Trim().ToLowerInvariant();
        if (normalized.Length == 0 || normalized is "month" or "monthly" or "1m") return 1;
        if (normalized is "quarter" or "quarterly" or "3m") return 3;
        if (normalized is "semiannual" or "semi-annual" or "half-yearly" or "6m") return 6;
        if (normalized is "annual" or "annually" or "year" or "yearly" or "12m") return 12;

        foreach (var token in normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (int.TryParse(token, out var months) && months > 0)
                return months;
        }

        return 1;
    }

    private static void Add(List<ForecastPoint> result, DateOnly date, Dictionary<string, double> values,
        List<ProjectedAsset> assets, double contributions, double windfalls, List<string> order)
    {
        var stacks = order.ToDictionary(x => x, _ => 0d);
        foreach (var asset in assets) stacks[asset.Type] += values[asset.Key];
        stacks[ContributionsStack] = contributions;
        if (stacks.ContainsKey(WindfallsStack)) stacks[WindfallsStack] = windfalls;
        result.Add(new() { Date = date.ToString("yyyy-MM-dd"), Values = stacks, Total = stacks.Values.Sum() });
    }

    private static double Monthly(double annual) => annual <= -1 ? -1 : Math.Pow(1 + annual, 1d / 12) - 1;
    private static string Label(string value) => char.ToUpperInvariant(value[0]) + value[1..].ToLowerInvariant();
    private static bool IsUndeployed(ProjectedAsset asset) =>
        asset.Name.EndsWith(" (undeployed)", StringComparison.OrdinalIgnoreCase);

    private sealed record RecurringContribution(Guid? AssetId, double Amount, int IntervalMonths)
    {
        public bool IsDue(int period) => period >= 1 && (period - 1) % IntervalMonths == 0;
    }

    private sealed class ContributionPlan(
        Dictionary<Guid, List<RecurringContribution>> allocated,
        List<RecurringContribution> unallocated)
    {
        public bool HasAllocation(Guid? assetId) => assetId is Guid id && allocated.ContainsKey(id);

        public double UnallocatedForPeriod(int period) =>
            unallocated.Where(contribution => contribution.IsDue(period)).Sum(contribution => contribution.Amount);

        public double ForAssetPeriod(Guid? assetId, int period) =>
            assetId is Guid id && allocated.TryGetValue(id, out var contributions)
                ? contributions.Where(contribution => contribution.IsDue(period)).Sum(contribution => contribution.Amount)
                : 0;
    }

    private sealed record HistoricalPoint(
        DateOnly Date, TimeOnly Time, decimal Value, decimal? InvestedCapital, bool IsInvestment);

    private sealed record MonthlyObservation(DateOnly Month, double GrowthFactor, bool IsCashFlowAdjusted);

    private sealed record ProjectedAsset(string RawType, string Name, Guid? AssetId, decimal Value,
        double Rate, string Source, bool Adjusted, int PeriodCount)
    {
        public string Type => Label(RawType);
        public string Key => AssetId is Guid assetId
            ? $"{assetId:D}\0{RawType}\0{Name}"
            : $"{RawType}\0{Name}";
    }

    private static decimal GetNetValue(AssetValueEntry entry) =>
        entry.AssetKindCode.Equals(AssetKindCodes.Property, StringComparison.OrdinalIgnoreCase) && entry is PropertyAssetValueEntry property
            ? entry.Value - (property.Mortgage ?? 0)
            : entry.Value;
}

public sealed record HistoricalRateResult(
    double AnnualRate, string Source, bool IsCashFlowAdjusted, int PeriodCount = 0);

public sealed class ForecastResponse
{
    public List<ForecastPoint> Projection { get; set; } = new();
    public List<string> StackOrder { get; set; } = new();
    public List<HistoricalRateSource> RateSources { get; set; } = new();
    public string SelectedStrategy { get; set; } = ForecastCalculator.FireDefaultStrategy;
    public string SelectedStrategyDescription { get; set; } = "";
    public int TargetHitMonth { get; set; }
    public string? TargetHitDate { get; set; }
    public decimal CurrentNW { get; set; }

    // Read-only compatibility aliases for older API consumers. The UI uses Projection only.
    public List<ForecastPoint> Expected { get => Projection; set => Projection = value; }
    public List<ForecastPoint> HistoricalTrend { get => Projection; set => Projection = value; }
    public int TrendTargetHitMonth { get => TargetHitMonth; set => TargetHitMonth = value; }
    public string? TrendTargetHitDate { get => TargetHitDate; set => TargetHitDate = value; }
}

public sealed class ForecastPoint
{
    public string Date { get; set; } = "";
    public Dictionary<string, double> Values { get; set; } = new();
    public double Total { get; set; }
}

public sealed class HistoricalRateSource
{
    public string AssetName { get; set; } = "";
    public string AssetType { get; set; } = "";
    public double AnnualRatePercent { get; set; }
    public string Source { get; set; } = "";
    public bool IsCashFlowAdjusted { get; set; }
    public int HistoricalPeriodCount { get; set; }
}
