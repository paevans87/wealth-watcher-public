namespace WealthWatcher.Api.Models;

/// <summary>
/// Property-specific extension data for an Asset whose AssetKind is Property.
/// The Asset row is the sole identity.
/// </summary>
public class PropertyDetail
{
    public Guid AssetId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Asset? Asset { get; set; }
}

/// <summary>
/// Compatibility name for callers that still refer to a property definition.
/// </summary>
[Obsolete("Use PropertyDetail. The Asset row is the property identity.")]
public class PropertyDefinition : PropertyDetail
{
    public string Name
    {
        get => Asset?.DisplayName ?? string.Empty;
        set
        {
            if (Asset is not null)
                Asset.DisplayName = value;
        }
    }

    public DateTimeOffset? ArchivedAt
    {
        get => Asset?.ArchivedAt;
        set
        {
            if (Asset is not null)
                Asset.ArchivedAt = value;
        }
    }
}
