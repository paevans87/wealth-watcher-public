using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace WealthWatcher.WebhookRelay;

public sealed class RelayInstallationRegistry(IOptions<RelayOptions> options)
{
    private readonly IReadOnlyDictionary<string, RelayInstallationOptions> installations =
        options.Value.Installations
            .Where(installation => !string.IsNullOrWhiteSpace(installation.Id))
            .GroupBy(installation => installation.Id.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.OrdinalIgnoreCase);

    public bool IsKnown(string installationId) =>
        installations.ContainsKey(installationId);

    /// <summary>
    /// Gets the only configured API pairing for this self-hosted relay.
    /// Provider webhooks use the relay host as the deployment identity, so
    /// they do not carry an installation segment in their public URL.
    /// </summary>
    public bool TryGetSingleInstallationId(out string installationId)
    {
        if (installations.Count == 1)
        {
            installationId = installations.Keys.Single();
            return true;
        }

        installationId = string.Empty;
        return false;
    }

    public bool Authenticate(string installationId, string? token)
    {
        if (!installations.TryGetValue(installationId, out var installation) ||
            string.IsNullOrWhiteSpace(token))
            return false;

        var expected = Encoding.UTF8.GetBytes(installation.Token);
        var actual = Encoding.UTF8.GetBytes(token);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }
}
