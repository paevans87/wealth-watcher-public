using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Integrations;

/// <summary>
/// The weekly market-hours document used by scheduled integration polling.
/// Times are stored as local wall-clock values and evaluated against the
/// server's local clock.
/// </summary>
public sealed class MarketHoursSettings
{
    public IReadOnlyList<MarketHoursDaySettings> Days { get; init; } = CreateDefaultDays();

    public static MarketHoursSettings CreateDefault() => new()
    {
        Days = CreateDefaultDays()
    };

    public static MarketHoursSettings NormalizeAndValidate(MarketHoursSettings? settings)
    {
        settings ??= CreateDefault();
        if (settings.Days is null || settings.Days.Count != 7)
            throw new ArgumentException("Market hours must define one row for each day of the week.");

        var seenDays = new HashSet<DayOfWeek>();
        var normalizedDays = new List<MarketHoursDaySettings>(7);
        foreach (var day in settings.Days)
        {
            if (day is null)
                throw new ArgumentException("Market hours cannot contain an empty day row.");
            if (!Enum.TryParse<DayOfWeek>(day.Day, ignoreCase: true, out var parsedDay))
                throw new ArgumentException($"'{day.Day}' is not a valid day of the week.");
            if (!seenDays.Add(parsedDay))
                throw new ArgumentException($"Market hours contain more than one row for {parsedDay}.");
            if (!TimeOnly.TryParseExact(
                    day.OpenTime,
                    "HH:mm",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var openTime) ||
                !TimeOnly.TryParseExact(
                    day.CloseTime,
                    "HH:mm",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var closeTime))
            {
                throw new ArgumentException($"Market hours for {parsedDay} must use HH:mm times.");
            }

            if (openTime >= closeTime)
                throw new ArgumentException($"Market hours for {parsedDay} must open before they close.");

            normalizedDays.Add(new MarketHoursDaySettings
            {
                Day = parsedDay.ToString(),
                Enabled = day.Enabled,
                OpenTime = openTime.ToString("HH:mm", CultureInfo.InvariantCulture),
                CloseTime = closeTime.ToString("HH:mm", CultureInfo.InvariantCulture)
            });
        }

        if (seenDays.Count != 7)
            throw new ArgumentException("Market hours must define one row for each day of the week.");

        return new MarketHoursSettings
        {
            Days = normalizedDays
                .OrderBy(day => DaySortIndex(ParseDay(day.Day)))
                .ToList()
        };
    }

    private static IReadOnlyList<MarketHoursDaySettings> CreateDefaultDays() =>
        WeekdayOrder.Select(day => new MarketHoursDaySettings
        {
            Day = day.ToString(),
            Enabled = day is not (DayOfWeek.Saturday or DayOfWeek.Sunday),
            OpenTime = "08:00",
            CloseTime = "16:30"
        }).ToList();

    private static DayOfWeek ParseDay(string day) =>
        Enum.Parse<DayOfWeek>(day, ignoreCase: true);

    private static int DaySortIndex(DayOfWeek day) =>
        Array.IndexOf(WeekdayOrder, day);

    private static readonly DayOfWeek[] WeekdayOrder =
    [
        DayOfWeek.Monday,
        DayOfWeek.Tuesday,
        DayOfWeek.Wednesday,
        DayOfWeek.Thursday,
        DayOfWeek.Friday,
        DayOfWeek.Saturday,
        DayOfWeek.Sunday
    ];
}

public sealed class MarketHoursDaySettings
{
    public string Day { get; init; } = nameof(DayOfWeek.Monday);
    public bool Enabled { get; init; }
    public string OpenTime { get; init; } = "08:00";
    public string CloseTime { get; init; } = "16:30";
}

public static class MarketHoursPolicy
{
    public static bool IsWithinMarketHours(DateTimeOffset utcNow, MarketHoursSettings settings)
    {
        var localNow = utcNow.ToLocalTime();
        var day = settings.Days.FirstOrDefault(candidate =>
            string.Equals(candidate.Day, localNow.DayOfWeek.ToString(), StringComparison.OrdinalIgnoreCase));
        if (day is null || !day.Enabled ||
            !TimeOnly.TryParseExact(day.OpenTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var openTime) ||
            !TimeOnly.TryParseExact(day.CloseTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var closeTime))
            return false;

        var localTime = TimeOnly.FromDateTime(localNow.DateTime);
        return localTime >= openTime && localTime < closeTime;
    }
}

public sealed class IntegrationSettingsService(
    WealthDbContext db,
    ILogger<IntegrationSettingsService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<MarketHoursSettings> GetMarketHoursAsync(
        CancellationToken cancellationToken = default)
    {
        var json = await db.AppPreferences
            .AsNoTracking()
            .Where(preference => preference.Id == 1)
            .Select(preference => preference.IntegrationJson)
            .SingleOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(json))
            return MarketHoursSettings.CreateDefault();

        try
        {
            var settings = JsonSerializer.Deserialize<MarketHoursSettings>(json, JsonOptions);
            return MarketHoursSettings.NormalizeAndValidate(settings);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Ignoring malformed persisted market-hours settings.");
            return MarketHoursSettings.CreateDefault();
        }
        catch (ArgumentException exception)
        {
            logger.LogWarning(exception, "Ignoring invalid persisted market-hours settings.");
            return MarketHoursSettings.CreateDefault();
        }
    }

    public async Task<MarketHoursSettings> SaveMarketHoursAsync(
        MarketHoursSettings settings,
        CancellationToken cancellationToken = default)
    {
        var normalized = MarketHoursSettings.NormalizeAndValidate(settings);
        var preference = await db.AppPreferences.FindAsync([1], cancellationToken);
        if (preference is null)
        {
            preference = new AppPreference();
            db.AppPreferences.Add(preference);
        }

        preference.IntegrationJson = JsonSerializer.Serialize(normalized, JsonOptions);
        await db.SaveChangesAsync(cancellationToken);
        return normalized;
    }
}
