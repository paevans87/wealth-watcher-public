using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace WealthWatcher.Api.Models;

public enum AssetValueEntrySourceKind
{
    Manual = 1,
    Integration = 2
}

/// <summary>
/// Join/source row for an AssetValueEntry. Provider identity is kept out of
/// the fact row and is resolved through ExternalValue.
/// </summary>
public class AssetValueEntrySource
{
    public int AssetValueEntryId { get; set; }
    public Guid? ExternalValueId { get; set; }
    public int? SyncRunId { get; set; }
    public AssetValueEntrySourceKind SourceKind { get; set; }

    [JsonIgnore]
    public AssetValueEntry? AssetValueEntry { get; set; }

    [JsonIgnore]
    public ExternalValue? ExternalValue { get; set; }

    [JsonIgnore]
    public SyncRun? SyncRun { get; set; }

    [NotMapped]
    public bool IsIntegration => SourceKind == AssetValueEntrySourceKind.Integration;
}
