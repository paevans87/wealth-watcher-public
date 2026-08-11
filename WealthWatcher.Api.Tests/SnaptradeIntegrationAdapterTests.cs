using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using WealthWatcher.Api.Integrations;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class SnaptradeIntegrationAdapterTests
{
    [Fact]
    public async Task Discover_accounts_reads_nested_account_metadata()
    {
        using var handler = new QueueHttpMessageHandler(JsonResponse(AccountResponse()));
        using var client = new HttpClient(handler);
        var adapter = new SnaptradeIntegrationAdapter(client, NullLogger<SnaptradeIntegrationAdapter>.Instance);

        var accounts = await adapter.DiscoverAccountsAsync(CreateContext(), CancellationToken.None);

        var account = Assert.Single(accounts);
        Assert.Equal("account-1", account.ExternalId);
        Assert.Equal("SIPP", account.DisplayName);
        Assert.Equal("SIPP", account.AccountType);
        Assert.Equal("GBP", account.Currency);
        Assert.Equal(["/api/v1/accounts"], handler.Paths);
    }

    [Fact]
    public async Task Pull_returns_deployed_value_and_labels_cash_as_undeployed()
    {
        using var accounts = JsonResponse(AccountResponse());
        using var balances = JsonResponse("""
            [
              {
                "currency": { "code": "GBP" },
                "cash": 65.44,
                "buying_power": 65.44
              }
            ]
            """);
        using var positions = JsonResponse("[]");
        using var handler = new QueueHttpMessageHandler(accounts, balances, positions);
        using var client = new HttpClient(handler);
        var adapter = new SnaptradeIntegrationAdapter(client, NullLogger<SnaptradeIntegrationAdapter>.Instance);

        var result = await adapter.PullAsync(
            CreateContext(),
            [new ExternalAccount
            {
                ExternalId = "account-1",
                DisplayName = "SIPP",
                AccountType = "SIPP",
                Currency = "GBP"
            }],
            CancellationToken.None);

        Assert.Empty(result.Errors);
        Assert.Equal(2, result.Values.Count);

        var total = Assert.Single(result.Values, value => value.ExternalValueId.EndsWith(":investments", StringComparison.Ordinal));
        Assert.Equal(127046.00m, total.Value);
        Assert.Equal("SIPP", total.Name);
        Assert.Null(total.NameSuffix);

        var cash = Assert.Single(result.Values, value => value.ExternalValueId.EndsWith(":cash", StringComparison.Ordinal));
        Assert.Equal(65.44m, cash.Value);
        Assert.Equal("SIPP", cash.Name);
        Assert.Equal(" (undeployed)", cash.NameSuffix);
        Assert.Equal(
            ["/api/v1/accounts", "/api/v1/accounts/account-1/balances", "/api/v1/accounts/account-1/positions"],
            handler.Paths);
    }

    [Fact]
    public async Task Pull_emits_zero_cash_snapshot_for_an_empty_cash_balance()
    {
        using var accounts = JsonResponse(AccountResponse());
        using var balances = JsonResponse("""
            [
              {
                "currency": { "code": "GBP" },
                "cash": 0,
                "buying_power": 0
              }
            ]
            """);
        using var positions = JsonResponse("[]");
        using var handler = new QueueHttpMessageHandler(accounts, balances, positions);
        using var client = new HttpClient(handler);
        var adapter = new SnaptradeIntegrationAdapter(client, NullLogger<SnaptradeIntegrationAdapter>.Instance);

        var result = await adapter.PullAsync(
            CreateContext(),
            [new ExternalAccount { ExternalId = "account-1", DisplayName = "SIPP", AccountType = "SIPP", Currency = "GBP" }],
            CancellationToken.None);

        var cash = Assert.Single(result.Values, value => value.ExternalValueId.EndsWith(":cash", StringComparison.Ordinal));
        Assert.Equal(0m, cash.Value);
    }

    private static IntegrationContext CreateContext() => new()
    {
        ProviderKey = SnaptradeIntegrationAdapter.ProviderKey,
        ConnectionId = Guid.NewGuid(),
        DisplayName = "SnapTrade",
        Credentials = new Dictionary<string, string>
        {
            ["clientId"] = "test-client",
            ["consumerKey"] = "test-consumer"
        },
        Options = JsonDocument.Parse("{}").RootElement
    };

    private static string AccountResponse() => """
        [
          {
            "id": "account-1",
            "name": "SIPP",
            "raw_type": "SIPP",
            "institution_name": "AJ Bell",
            "meta": { "currency": "GBP", "institution_name": "AJ Bell" },
            "balance": {
              "total": {
                "amount": 127111.44,
                "currency": "GBP"
              }
            }
          }
        ]
        """;

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private sealed class QueueHttpMessageHandler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> responses = new(responses);

        public List<string> Paths { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Paths.Add(request.RequestUri!.AbsolutePath);
            return Task.FromResult(responses.Dequeue());
        }
    }
}
