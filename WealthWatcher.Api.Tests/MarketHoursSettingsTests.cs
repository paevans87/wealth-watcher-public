using WealthWatcher.Api.Integrations;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class MarketHoursSettingsTests
{
    [Theory]
    [InlineData(10, 8, 0, true)]
    [InlineData(10, 16, 29, true)]
    [InlineData(10, 16, 30, false)]
    [InlineData(9, 12, 0, false)]
    public void Market_hours_are_open_only_inside_an_enabled_weekday_window(int day, int hour, int minute, bool expected)
    {
        var settings = CreateSettings();
        var local = new DateTimeOffset(
            new DateTime(2026, 8, day, hour, minute, 0, DateTimeKind.Unspecified));

        Assert.Equal(expected, MarketHoursPolicy.IsWithinMarketHours(local, settings));
    }

    [Fact]
    public void Market_hours_use_the_server_local_clock()
    {
        var settings = CreateSettings();
        var localMorning = new DateTimeOffset(
            new DateTime(2026, 8, 10, 8, 0, 0, DateTimeKind.Unspecified));

        Assert.True(MarketHoursPolicy.IsWithinMarketHours(localMorning, settings));
    }

    [Fact]
    public void Validation_requires_distinct_days_and_ordered_times()
    {
        var settings = CreateSettings();
        var duplicateDay = settings.Days
            .Select((day, index) => index == 2
                ? new MarketHoursDaySettings
                {
                    Day = "Monday",
                    Enabled = day.Enabled,
                    OpenTime = day.OpenTime,
                    CloseTime = day.CloseTime
                }
                : day)
            .ToList();

        Assert.Throws<ArgumentException>(() => MarketHoursSettings.NormalizeAndValidate(new MarketHoursSettings
        {
            Days = duplicateDay
        }));

        var invalidTimes = settings.Days
            .Select((day, index) => index == 0
                ? new MarketHoursDaySettings
                {
                    Day = day.Day,
                    Enabled = day.Enabled,
                    OpenTime = "16:30",
                    CloseTime = "08:00"
                }
                : day)
            .ToList();

        Assert.Throws<ArgumentException>(() => MarketHoursSettings.NormalizeAndValidate(new MarketHoursSettings
        {
            Days = invalidTimes
        }));
    }

    private static MarketHoursSettings CreateSettings() => new()
    {
        Days = Enum.GetValues<DayOfWeek>()
            .Select(day => new MarketHoursDaySettings
            {
                Day = day.ToString(),
                Enabled = day is not (DayOfWeek.Saturday or DayOfWeek.Sunday),
                OpenTime = "08:00",
                CloseTime = "16:30"
            })
            .ToList()
    };
}
