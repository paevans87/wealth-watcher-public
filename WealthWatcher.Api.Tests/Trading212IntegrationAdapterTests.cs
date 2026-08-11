using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using WealthWatcher.Api.Integrations;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class Trading212IntegrationAdapterTests
{
    [Fact]
    public async Task Test_retries_account_summary_after_rate_limit()
    {
        using var rateLimited = RateLimitedResponse();
        using var success = JsonResponse("{\"id\":12345,\"currency\":\"GBP\",\"totalValue\":1000.50}");
        using var handler = new QueueHttpMessageHandler(rateLimited, success);
        using var client = new HttpClient(handler);
        var adapter = new Trading212IntegrationAdapter(client, NullLogger<Trading212IntegrationAdapter>.Instance);

        using var options = JsonDocument.Parse("{\"environment\":\"demo\"}");
        var result = await adapter.TestAsync(CreateContext(options.RootElement), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Single(result.Accounts);
        Assert.Equal("Trading 212 account 12345", result.Accounts[0].DisplayName);
        Assert.Equal(2, handler.RequestCount);
    }

    [Fact]
    public async Task Test_reports_actionable_message_when_rate_limit_retry_is_exhausted()
    {
        using var firstRateLimited = RateLimitedResponse();
        using var secondRateLimited = RateLimitedResponse();
        using var handler = new QueueHttpMessageHandler(firstRateLimited, secondRateLimited);
        using var client = new HttpClient(handler);
        var adapter = new Trading212IntegrationAdapter(client, NullLogger<Trading212IntegrationAdapter>.Instance);

        using var options = JsonDocument.Parse("{\"environment\":\"demo\"}");
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            adapter.TestAsync(CreateContext(options.RootElement), CancellationToken.None));

        Assert.Contains("rate limit", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("account summary", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, handler.RequestCount);
    }

    private static IntegrationContext CreateContext(JsonElement options) => new()
    {
        ProviderKey = Trading212IntegrationAdapter.ProviderKey,
        ConnectionId = Guid.NewGuid(),
        DisplayName = "Trading 212 demo",
        Credentials = new Dictionary<string, string>
        {
            ["apiKey"] = "test-key",
            ["apiSecret"] = "test-secret"
        },
        Options = options
    };

    private static HttpResponseMessage RateLimitedResponse()
    {
        var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.Zero);
        return response;
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private sealed class QueueHttpMessageHandler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> responses = new(responses);

        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            return Task.FromResult(responses.Dequeue());
        }
    }
}
