using WealthWatcher.Api.Extensions;
using WealthWatcher.Api.Models;
using Xunit;

namespace WealthWatcher.Api.Tests;

public class ForecastCalculatorTests
{
    [Fact]
    public void CashFlowAdjustedCagr_UsesOneCompletedMonthAndRemovesKnownContribution()
    {
        var result = ForecastCalculator.CalculateHistoricalRate(
            [
                Investment("ISA", 100m, new DateOnly(2025, 1, 1), 100m),
                Investment("ISA", 160m, new DateOnly(2025, 1, 31), 150m)
            ], ForecastCalculator.CashFlowAdjustedCagrStrategy, 6m, new DateOnly(2025, 2, 1));

        Assert.Equal(Math.Pow(1.1d, 12) - 1, result.AnnualRate, 8);
        Assert.Equal(ForecastCalculator.CashFlowAdjustedCagrStrategy, result.Source);
        Assert.True(result.IsCashFlowAdjusted);
        Assert.Equal(1, result.PeriodCount);
    }

    [Fact]
    public void FirstLastAnnualized_UsesTheFirstAndLastObservedValues()
    {
        var result = ForecastCalculator.CalculateHistoricalRate(
            [
                Investment("ISA", 100m, new DateOnly(2025, 1, 1), 100m),
                Investment("ISA", 120m, new DateOnly(2026, 1, 1), 120m)
            ], ForecastCalculator.FirstLastAnnualizedStrategy, 6m, new DateOnly(2026, 2, 1));

        Assert.Equal(.2d, result.AnnualRate, 8);
        Assert.Equal(ForecastCalculator.FirstLastAnnualizedStrategy, result.Source);
        Assert.False(result.IsCashFlowAdjusted);
        Assert.Equal(2, result.PeriodCount);
    }

    [Fact]
    public void FirstLastAnnualized_CompoundsTheObservedReturnAcrossMultipleYears()
    {
        var result = ForecastCalculator.CalculateHistoricalRate(
            [
                Investment("ISA", 100m, new DateOnly(2025, 1, 1), 100m),
                Investment("ISA", 144m, new DateOnly(2027, 1, 1), 144m)
            ], ForecastCalculator.FirstLastAnnualizedStrategy, 6m, new DateOnly(2027, 2, 1));

        Assert.Equal(.2d, result.AnnualRate, 8);
    }

    [Fact]
    public void FirstLastAnnualized_FallsBackForMissingZeroOrOnePointHistory()
    {
        var empty = ForecastCalculator.CalculateHistoricalRate(
            [], ForecastCalculator.FirstLastAnnualizedStrategy, 6m, new DateOnly(2026, 2, 1));
        var zeroBaseline = ForecastCalculator.CalculateHistoricalRate(
            [
                Investment("ISA", 0m, new DateOnly(2025, 1, 1), 0m),
                Investment("ISA", 120m, new DateOnly(2026, 1, 1), 120m)
            ], ForecastCalculator.FirstLastAnnualizedStrategy, 6m, new DateOnly(2026, 2, 1));
        var onePoint = ForecastCalculator.CalculateHistoricalRate(
            [Investment("ISA", 100m, new DateOnly(2025, 1, 1), 100m)],
            ForecastCalculator.FirstLastAnnualizedStrategy, 6m, new DateOnly(2026, 2, 1));

        foreach (var result in new[] { empty, zeroBaseline, onePoint })
        {
            Assert.Equal(.06d, result.AnnualRate, 8);
            Assert.Equal("fallback", result.Source);
            Assert.Equal(0, result.PeriodCount);
        }
    }

    [Fact]
    public void MedianMonthlyReturn_UsesTheMedianOfCompletedMonths()
    {
        var result = HistoricalRate(ForecastCalculator.MedianMonthlyReturnStrategy, [0.10, -0.10, 0.20]);

        Assert.Equal(Math.Pow(1.10d, 12) - 1, result.AnnualRate, 8);
        Assert.Equal(3, result.PeriodCount);
    }

    [Fact]
    public void WeightedLogReturn_PutsMoreWeightOnRecentMonths()
    {
        var factors = new[] { 1d, 1.10d, 0.90d };
        var weightedLog = factors.Select((factor, index) => (index + 1) * Math.Log(factor)).Sum() / 6d;
        var result = HistoricalRate(ForecastCalculator.WeightedLogReturnStrategy, [0, 0.10, -0.10]);

        Assert.Equal(Math.Exp(weightedLog * 12) - 1, result.AnnualRate, 8);
        Assert.Equal(ForecastCalculator.WeightedLogReturnStrategy, result.Source);
    }

    [Fact]
    public void RegressionTrend_UsesTheSlopeOfCumulativeLogWealth()
    {
        var factors = new[] { 1.10d, 0.90d, 1.20d };
        var cumulative = new[] { Math.Log(1.10d), Math.Log(1.10d * .90d), Math.Log(1.10d * .90d * 1.20d) };
        var slope = ((0 - 1) * (cumulative[0] - cumulative.Average())
            + (1 - 1) * (cumulative[1] - cumulative.Average())
            + (2 - 1) * (cumulative[2] - cumulative.Average())) / 2d;
        var result = HistoricalRate(ForecastCalculator.RegressionTrendStrategy, [0.10, -0.10, 0.20]);

        Assert.Equal(Math.Exp(slope * 12) - 1, result.AnnualRate, 8);
        Assert.Equal(ForecastCalculator.RegressionTrendStrategy, result.Source);
    }

    [Fact]
    public void WinsorizedMonthlyReturn_ClampsTheExtremeCompletedMonth()
    {
        var factors = new[] { 1d, 1.02d, 1.03d, 2d };
        var lower = 1d + .02d * .3d;
        var upper = 1.03d + (2d - 1.03d) * .7d;
        var expected = Math.Exp(new[] { lower, 1.02d, 1.03d, upper }.Select(value => Math.Log(value)).Average() * 12) - 1;
        var result = HistoricalRate(ForecastCalculator.WinsorizedMonthlyReturnStrategy, [0, .02, .03, 1]);

        Assert.Equal(expected, result.AnnualRate, 8);
        Assert.Equal(ForecastCalculator.WinsorizedMonthlyReturnStrategy, result.Source);
    }

    [Fact]
    public void EveryHistoricalStrategyWorksWithOneCompletedMonth()
    {
        foreach (var strategy in ForecastCalculator.HistoricalStrategies)
        {
            var result = HistoricalRate(strategy, [0.10]);

            Assert.NotEqual("fallback", result.Source);
            var expected = strategy == ForecastCalculator.FirstLastAnnualizedStrategy
                ? Math.Pow(1.10d, 365d / 30d) - 1
                : Math.Pow(1.10d, 12) - 1;
            Assert.Equal(expected, result.AnnualRate, 8);
            Assert.Equal(1, result.PeriodCount);
        }
    }

    [Fact]
    public void HistoricalStrategiesUseConfiguredFireReturnOnlyWhenDataIsInsufficient()
    {
        foreach (var strategy in ForecastCalculator.HistoricalStrategies)
        {
            var result = ForecastCalculator.CalculateHistoricalRate(
                [Investment("New ISA", 100m, new DateOnly(2025, 1, 15), 100m)],
                strategy, 6m, new DateOnly(2025, 2, 1));

            Assert.Equal(.06d, result.AnnualRate, 8);
            Assert.Equal("fallback", result.Source);
            Assert.Equal(0, result.PeriodCount);
        }
    }

    [Fact]
    public void FireDefaultStrategyUsesConfiguredReturnEvenWhenHistoryExists()
    {
        var result = HistoricalRate(ForecastCalculator.FireDefaultStrategy, [0.25, -0.20]);

        Assert.Equal(.06d, result.AnnualRate, 8);
        Assert.Equal(ForecastCalculator.FireDefaultStrategy, result.Source);
        Assert.Equal(0, result.PeriodCount);
    }

    [Fact]
    public void ForecastResponseUsesOneSelectedProjectionAndPreservesContributionsAndWindfalls()
    {
        var result = ForecastCalculator.Calculate(
            [
                Investment("ISA", 100m, new DateOnly(2025, 1, 1), 100m),
                Investment("ISA", 110m, new DateOnly(2025, 1, 31), 100m)
            ],
            new ForecastRequest {
                Target = 500m,
                AnnualReturn = 4m,
                MonthlyContribution = 10m,
                ForecastStrategy = ForecastCalculator.MedianMonthlyReturnStrategy,
                IncludedAssets = ["investments"],
                Windfalls = [new WindfallDto { Amount = 50m, ExpectedDate = "2025-06-01", IncludeInCalculation = true }]
            },
            new DateOnly(2025, 2, 1));

        Assert.Equal(ForecastCalculator.MedianMonthlyReturnStrategy, result.SelectedStrategy);
        Assert.Equal(ForecastCalculator.DescribeStrategy(result.SelectedStrategy), result.SelectedStrategyDescription);
        Assert.Equal(result.Projection, result.Expected);
        Assert.Equal(result.Projection, result.HistoricalTrend);
        Assert.Contains(result.Projection, point => point.Values[ForecastCalculator.ContributionsStack] > 0);
        Assert.Contains(result.Projection, point => point.Values[ForecastCalculator.WindfallsStack] == 50);
        Assert.All(result.Projection, point => Assert.Equal(point.Total, point.Values.Values.Sum(), 8));
    }

    [Fact]
    public void ForecastIgnoresFutureSnapshotsForCurrentValueAndHistoricalRate()
    {
        var today = new DateOnly(2026, 2, 1);
        var result = ForecastCalculator.Calculate(
            [
                Investment("ISA", 100m, new DateOnly(2026, 1, 1), 100m),
                Investment("ISA", 110m, new DateOnly(2026, 1, 31), 100m),
                Investment("ISA", 10_000m, new DateOnly(2040, 1, 1), 100m)
            ],
            new ForecastRequest {
                Target = 100_000m,
                AnnualReturn = 6m,
                ForecastStrategy = ForecastCalculator.FirstLastAnnualizedStrategy,
                IncludedAssets = ["investments"]
            },
            today);

        var expectedAnnualRate = Math.Pow(1.1d, 365d / 30d) - 1;
        var current = Assert.Single(result.Projection, point => point.Date == today.ToString("yyyy-MM-dd"));
        var rate = Assert.Single(result.RateSources);

        Assert.Equal(110m, result.CurrentNW);
        Assert.Equal(110d, current.Values["Investments"]);
        Assert.Equal(expectedAnnualRate * 100, rate.AnnualRatePercent, 8);
    }

    [Fact]
    public void ForecastIncludesCurrentMonthFutureWindfallInFirstProjectionPeriod()
    {
        var today = new DateOnly(2026, 6, 15);
        var result = ForecastCalculator.Calculate(
            [Investment("ISA", 100m, today, 100m)],
            new ForecastRequest {
                Target = 100_000m,
                AnnualReturn = 0m,
                IncludedAssets = ["investments"],
                Windfalls = [new WindfallDto {
                    Amount = 50m,
                    ExpectedDate = "2026-06-30",
                    IncludeInCalculation = true
                }]
            },
            today);

        var current = Assert.Single(result.Projection, point => point.Date == today.ToString("yyyy-MM-dd"));
        var firstAnnualProjection = Assert.Single(result.Projection, point => point.Date == "2027-01-01");

        Assert.Equal(0d, current.Values[ForecastCalculator.WindfallsStack]);
        Assert.Equal(50d, firstAnnualProjection.Values[ForecastCalculator.WindfallsStack]);
        Assert.Equal(150d, firstAnnualProjection.Total);
    }

    [Fact]
    public void Allocated_and_unallocated_budget_savings_are_projected_separately()
    {
        var assetId = Guid.NewGuid();
        var entry = new InvestmentEntry(
            "Investments", "investments", 1_000m, null, new DateOnly(2026, 6, 15), TimeOnly.MinValue)
        { AssetId = assetId };
        var request = new ForecastRequest
        {
            Target = 100_000m,
            AnnualReturn = 0m,
            IncludedAssets = ["investments"],
            Contributions = [
                new ForecastContributionDto { Name = "ISA", Amount = 100m, AssetId = assetId },
                new ForecastContributionDto { Name = "Emergency fund", Amount = 50m }
            ]
        };

        var result = ForecastCalculator.Calculate([entry], request, new DateOnly(2026, 6, 15));
        var january = Assert.Single(result.Projection, point => point.Date == "2027-01-01");

        Assert.Equal(1_700d, january.Values["Investments"]);
        Assert.Equal(350d, january.Values[ForecastCalculator.ContributionsStack]);
    }

    [Fact]
    public void Allocated_budget_savings_keep_a_zero_balance_asset_in_the_forecast()
    {
        var assetId = Guid.NewGuid();
        var entry = new InvestmentEntry(
            "New ISA", "investments", 0m, null, new DateOnly(2026, 1, 15), TimeOnly.MinValue)
        { AssetId = assetId };
        var request = new ForecastRequest {
            Target = 100_000m,
            AnnualReturn = 0m,
            IncludedAssets = ["investments"],
            Contributions = [new ForecastContributionDto { Name = "ISA saving", Amount = 100m, AssetId = assetId }]
        };

        var result = ForecastCalculator.Calculate([entry], request, new DateOnly(2026, 1, 15));

        Assert.Contains("Investments", result.StackOrder);
        var january = Assert.Single(result.Projection, point => point.Date == "2027-01-01");
        Assert.Equal(1_200d, january.Values["Investments"]);
    }

    private static HistoricalRateResult HistoricalRate(string strategy, double[] monthlyReturns) =>
        ForecastCalculator.CalculateHistoricalRate(
            MonthlyHistory(monthlyReturns), strategy, 6m,
            new DateOnly(2025, 1 + monthlyReturns.Length, 1));

    private static InvestmentEntry[] MonthlyHistory(double[] monthlyReturns)
    {
        var entries = new List<InvestmentEntry>();
        var value = 100m;
        for (var index = 0; index < monthlyReturns.Length; index++)
        {
            var month = new DateOnly(2025, index + 1, 1);
            entries.Add(Investment("ISA", value, month, 100m));
            value *= (decimal)(1 + monthlyReturns[index]);
            entries.Add(Investment("ISA", value,
                new DateOnly(month.Year, month.Month, DateTime.DaysInMonth(month.Year, month.Month)), 100m));
        }
        return entries.ToArray();
    }

    private static InvestmentEntry Investment(string name, decimal value, DateOnly date, decimal? capital = null) =>
        new(name, "investments", value, capital ?? value, date, TimeOnly.MinValue);
}
