namespace WealthWatcher.Api.Models;

/// <summary>
/// One local preference document. The fixed row identity replaces the
/// arbitrary text-key/value table.
/// </summary>
public class AppPreference
{
    public int Id { get; set; } = 1;
    public string GeneralJson { get; set; } = "{}";
    public string FeatureJson { get; set; } = "{}";
    public string ForecastJson { get; set; } = "{}";
    public string FireJson { get; set; } = "{}";
    public string IntegrationJson { get; set; } = "{}";
    public string MilestoneJson { get; set; } = MilestoneSettingsPolicy.DefaultJson;

    /// <summary>
    /// The optional versioned budget document. It is intentionally nullable so
    /// databases that only contain legacy BudgetLines remain valid and can be
    /// read without a data migration.
    /// </summary>
    public string? BudgetJson { get; set; }
}

[Obsolete("Use AppPreference.")]
public class UserSetting
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}
