namespace WealthWatcher.Api.Integrations.Webhooks;

/// <summary>
/// Defines configuration for the optional outbound webhook relay connection.
/// </summary>
public sealed class WebhookRelayOptions
{
    public const string SectionName = "WebhookRelay";

    /// <summary>
    /// Gets or sets whether the API should connect to a webhook relay.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets the relay WebSocket endpoint.
    /// </summary>
    public Uri? Url { get; set; }

    /// <summary>
    /// Gets or sets the optional HTTP endpoint used for API-originated relay
    /// diagnostics. When omitted it is derived from <see cref="Url"/>.
    /// </summary>
    public Uri? HttpUrl { get; set; }

    /// <summary>
    /// Gets or sets the private pairing identifier for this API and relay.
    /// It is used only for the outbound API-to-relay connection and is not
    /// part of the provider-facing webhook URL.
    /// </summary>
    public string? InstallationId { get; set; }

    /// <summary>
    /// Gets or sets the secret used to authenticate this API with the relay.
    /// </summary>
    public string? Token { get; set; }

    /// <summary>
    /// Gets or sets the optional public base URL used when displaying provider webhook setup instructions.
    /// </summary>
    public Uri? PublicBaseUrl { get; set; }

    internal bool IsValid(out string error)
    {
        if (!Enabled)
        {
            error = string.Empty;
            return true;
        }

        if (Url is null || (Url.Scheme != Uri.UriSchemeWs && Url.Scheme != Uri.UriSchemeWss))
        {
            error = "WebhookRelay:Url must be a ws:// or wss:// URL when webhook relay support is enabled.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(InstallationId) || InstallationId.Contains('/'))
        {
            error = "WebhookRelay:InstallationId is required and must not contain '/'.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(Token))
        {
            error = "WebhookRelay:Token is required when webhook relay support is enabled.";
            return false;
        }

        if (PublicBaseUrl is not null &&
            (PublicBaseUrl.Scheme != Uri.UriSchemeHttp && PublicBaseUrl.Scheme != Uri.UriSchemeHttps ||
             string.IsNullOrWhiteSpace(PublicBaseUrl.Host)))
        {
            error = "WebhookRelay:PublicBaseUrl must be an HTTP or HTTPS URL when provided.";
            return false;
        }

        if (HttpUrl is not null &&
            (HttpUrl.Scheme != Uri.UriSchemeHttp && HttpUrl.Scheme != Uri.UriSchemeHttps ||
             string.IsNullOrWhiteSpace(HttpUrl.Host)))
        {
            error = "WebhookRelay:HttpUrl must be an HTTP or HTTPS URL when provided.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}
