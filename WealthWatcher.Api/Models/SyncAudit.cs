using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

public enum SyncRunStatus
{
    Running = 1,
    Success = 2,
    Partial = 3,
    Failed = 4
}

/// <summary>
/// One execution of an integration sync, identified by connection rather
/// than a mutable provider/display name.
/// </summary>
public class SyncRun
{
    public int Id { get; set; }
    public Guid? IntegrationConnectionId { get; set; }
    public string ConnectionDisplayNameSnapshot { get; set; } = string.Empty;
    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset? EndTime { get; set; }
    public SyncRunStatus Status { get; set; } = SyncRunStatus.Running;
    public int RecordsAdded { get; set; }
    public string LogMessage { get; set; } = string.Empty;

    [JsonIgnore]
    public IntegrationConnection? IntegrationConnection { get; set; }
}

/// <summary>
/// The response contract used by the sync audit endpoint.
///
/// SyncRun is the persistence model, but the audit view historically consumed
/// ProviderName and a string status. Keep that presentation contract at the
/// API boundary rather than exposing the database entity directly.
/// </summary>
public sealed class SyncAuditResponse
{
    public int Id { get; init; }
    public string ProviderName { get; init; } = string.Empty;
    public DateTimeOffset StartTime { get; init; }
    public DateTimeOffset? EndTime { get; init; }
    public string Status { get; init; } = string.Empty;
    public int RecordsAdded { get; init; }
    public string LogMessage { get; init; } = string.Empty;

    public static SyncAuditResponse From(SyncRun run) => new()
    {
        Id = run.Id,
        ProviderName = run.ConnectionDisplayNameSnapshot,
        StartTime = run.StartTime,
        EndTime = run.EndTime,
        Status = run.Status.ToString(),
        RecordsAdded = run.RecordsAdded,
        LogMessage = run.LogMessage
    };
}

[Obsolete("Use SyncRun.")]
public class SyncAudit : SyncRun
{
}
