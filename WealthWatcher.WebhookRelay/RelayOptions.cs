namespace WealthWatcher.WebhookRelay;

public sealed class RelayOptions
{
    public const string SectionName = "Relay";

    /// <summary>
    /// Fallback SQLite path used when ConnectionStrings:RelayDatabase is not set.
    /// </summary>
    public string DatabasePath { get; set; } = "/data/relay.db";

    public long MaxWebhookBodyBytes { get; set; } = 1_048_576;
    public int DeliveryPollIntervalSeconds { get; set; } = 1;
    public int DeliveryAckTimeoutSeconds { get; set; } = 10;
    public int RetentionDays { get; set; } = 30;

    /// <summary>
    /// The local Wealth Watcher API pairing allowed to open an outbound
    /// connection. A self-hosted relay supports one pairing per relay host.
    /// </summary>
    public List<RelayInstallationOptions> Installations { get; set; } = [];

    /// <summary>
    /// Provider validation configuration, keyed by provider name.
    /// </summary>
    public Dictionary<string, RelayProviderOptions> Providers { get; set; } =
        new(StringComparer.OrdinalIgnoreCase);

    internal bool IsValid(out string error)
    {
        if (MaxWebhookBodyBytes is < 1 or > 16 * 1024 * 1024)
        {
            error = "Relay:MaxWebhookBodyBytes must be between 1 byte and 16 MB.";
            return false;
        }

        if (DeliveryPollIntervalSeconds is < 1 or > 300 ||
            DeliveryAckTimeoutSeconds is < 1 or > 300 ||
            RetentionDays is < 1 or > 3650)
        {
            error = "Relay delivery intervals and retention settings are outside their supported ranges.";
            return false;
        }

        var configuredIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (Installations.Count > 1)
        {
            error = "A self-hosted relay may configure only one Wealth Watcher pairing.";
            return false;
        }

        foreach (var installation in Installations)
        {
            if (string.IsNullOrWhiteSpace(installation.Id) ||
                installation.Id.Contains('/') ||
                string.IsNullOrWhiteSpace(installation.Token))
            {
                error = "Every relay installation requires a non-empty id, token, and an id without '/'.";
                return false;
            }

            if (!configuredIds.Add(installation.Id.Trim()))
            {
                error = "Relay installation ids must be unique.";
                return false;
            }
        }

        error = string.Empty;
        return true;
    }
}

public sealed class RelayInstallationOptions
{
    public string Id { get; set; } = string.Empty;
    public string Token { get; set; } = string.Empty;
}

public sealed class RelayProviderOptions
{
    public string? ConsumerKey { get; set; }
}
