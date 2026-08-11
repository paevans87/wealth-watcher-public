using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace WealthWatcher.Api.Integrations;

public interface IIntegrationCredentialProtector
{
    string Protect(IReadOnlyDictionary<string, string> credentials);
    IReadOnlyDictionary<string, string> Unprotect(string ciphertext);
}

public sealed class IntegrationCredentialProtector(IDataProtectionProvider provider)
    : IIntegrationCredentialProtector
{
    private readonly IDataProtector protector = provider.CreateProtector("WealthWatcher.IntegrationCredentials.v1");

    public string Protect(IReadOnlyDictionary<string, string> credentials)
    {
        var payload = JsonSerializer.Serialize(credentials);
        return protector.Protect(payload);
    }

    public IReadOnlyDictionary<string, string> Unprotect(string ciphertext)
    {
        if (string.IsNullOrWhiteSpace(ciphertext))
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }

        var payload = protector.Unprotect(ciphertext);
        return JsonSerializer.Deserialize<Dictionary<string, string>>(payload)
            ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }
}
