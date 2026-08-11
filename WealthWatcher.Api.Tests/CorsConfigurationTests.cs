using Microsoft.Extensions.Configuration;
using WealthWatcher.Api;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class CorsConfigurationTests
{
    [Fact]
    public void Missing_configuration_uses_loopback_defaults()
    {
        var origins = CorsConfiguration.GetAllowedOrigins(new ConfigurationManager());

        Assert.Contains("http://localhost:5173", origins);
        Assert.Contains("http://localhost:8182", origins);
    }

    [Fact]
    public void Configured_origins_are_filtered_to_http_origins()
    {
        var configuration = new ConfigurationManager
        {
            ["Cors:AllowedOrigins:0"] = "https://dashboard.example.test",
            ["Cors:AllowedOrigins:1"] = "file:///unsafe",
            ["Cors:AllowedOrigins:2"] = "https://dashboard.example.test/path",
            ["Cors:AllowedOrigins:3"] = "https://dashboard.example.test"
        };

        var origins = CorsConfiguration.GetAllowedOrigins(configuration);

        Assert.Equal(["https://dashboard.example.test"], origins);
    }
}
