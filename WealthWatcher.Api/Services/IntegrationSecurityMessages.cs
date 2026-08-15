using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Services;

/// <summary>
/// Client-safe messages used for integration failures and persisted sync
/// audit records. Provider and exception details must stay in local debugging
/// tools rather than crossing an API or persistence boundary.
/// </summary>
public static class IntegrationSecurityMessages
{
    public const string ConnectionOperationFailed =
        "The last integration operation failed. Check the integration settings and try again.";
    public const string TestFailed =
        "Integration test failed. Check the integration settings and try again.";
    public const string AccountDiscoveryFailed =
        "Account discovery failed. Check the integration settings and try again.";
    public const string SyncFailed =
        "Integration sync failed. Check the integration settings and try again.";
    public const string SyncCompleted = "Integration sync completed.";
    public const string SyncCompletedWithWarnings = "Integration sync completed with warnings.";
    public const string ProviderAccountPullFailed = "A provider account could not be synchronized.";
    public const string UnmappedProviderValue = "A provider value was returned for an unmapped account.";
    public const string MissingAssetAllocation = "A provider value is missing an asset allocation.";
    public const string UnsupportedCashValue = "Cash values are only supported for SnapTrade integrations.";
    public const string MappedAssetUnavailable = "A mapped asset is unavailable.";

    public static string SanitizeSyncError(string message) => message switch
    {
        UnmappedProviderValue => UnmappedProviderValue,
        MissingAssetAllocation => MissingAssetAllocation,
        UnsupportedCashValue => UnsupportedCashValue,
        MappedAssetUnavailable => MappedAssetUnavailable,
        ProviderAccountPullFailed => ProviderAccountPullFailed,
        _ => ProviderAccountPullFailed
    };

    public static string AuditMessage(SyncRunStatus status) => status switch
    {
        SyncRunStatus.Running => "Integration sync is in progress.",
        SyncRunStatus.Success => SyncCompleted,
        SyncRunStatus.Partial => SyncCompletedWithWarnings,
        SyncRunStatus.Failed => SyncFailed,
        _ => "Integration sync status updated."
    };
}
