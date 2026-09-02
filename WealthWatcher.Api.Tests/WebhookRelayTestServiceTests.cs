using System.Net;
using Microsoft.Extensions.Options;
using WealthWatcher.Api.Data;
using WealthWatcher.Api.Integrations.Webhooks;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class WebhookRelayTestServiceTests
{
    [Fact]
    public async Task Diagnostic_event_is_reported_successful_only_after_api_receipt()
    {
        var options = Options.Create(new WebhookRelayOptions
        {
            Enabled = true,
            Url = new Uri("ws://relay.example.com/ws"),
            HttpUrl = new Uri("http://relay.example.com"),
            InstallationId = "installation-1",
            Token = "relay-secret"
        });
        var control = new WebhookRelayControl(options);
        var tracker = new WebhookRelayTestTracker();
        var factory = new CallbackHttpClientFactory(async request =>
        {
            var testId = request.RequestUri!.Segments[^1];
            tracker.MarkReceived(testId, DateTimeOffset.UtcNow);
            await Task.CompletedTask;
            return new HttpResponseMessage(HttpStatusCode.Accepted);
        });
        var service = new WebhookRelayTestService(
            options,
            control,
            tracker,
            factory,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<WebhookRelayTestService>.Instance);

        var result = await service.RunAsync();

        Assert.True(result.Succeeded, result.Message);
        Assert.True(result.RelayAccepted);
        Assert.Equal(202, result.RelayStatusCode);
        Assert.NotNull(result.ApiReceivedAt);
        Assert.NotNull(result.TestId);
        Assert.Equal("Bearer relay-secret", factory.LastAuthorization);
    }

    [Fact]
    public async Task Diagnostic_event_is_not_sent_when_the_user_has_disabled_the_relay()
    {
        var options = Options.Create(new WebhookRelayOptions
        {
            Enabled = true,
            Url = new Uri("ws://relay.example.com/ws"),
            InstallationId = "installation-1",
            Token = "relay-secret"
        });
        var control = new WebhookRelayControl(options);
        control.SetEnabled(false);
        var factory = new CallbackHttpClientFactory(_ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Accepted)));
        var service = new WebhookRelayTestService(
            options,
            control,
            new WebhookRelayTestTracker(),
            factory,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<WebhookRelayTestService>.Instance);

        var result = await service.RunAsync();

        Assert.False(result.Succeeded);
        Assert.Contains("disabled", result.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Null(factory.LastRequest);
    }

    private sealed class CallbackHttpClientFactory(
        Func<HttpRequestMessage, Task<HttpResponseMessage>> callback) : IHttpClientFactory
    {
        public HttpRequestMessage? LastRequest { get; private set; }
        public string? LastAuthorization => LastRequest?.Headers.Authorization?.ToString();

        public HttpClient CreateClient(string name)
        {
            return new HttpClient(new CallbackHandler(request =>
            {
                LastRequest = request;
                return callback(request);
            }), disposeHandler: true);
        }
    }

    private sealed class CallbackHandler(
        Func<HttpRequestMessage, Task<HttpResponseMessage>> callback) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => callback(request);
    }
}
