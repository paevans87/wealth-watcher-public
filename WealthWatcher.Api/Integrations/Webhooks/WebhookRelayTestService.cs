using System.Net.Http.Headers;
using Microsoft.Extensions.Options;

namespace WealthWatcher.Api.Integrations.Webhooks;

public sealed class WebhookRelayTestService(
    IOptions<WebhookRelayOptions> options,
    WebhookRelayControl control,
    WebhookRelayTestTracker tracker,
    IHttpClientFactory httpClientFactory,
    ILogger<WebhookRelayTestService> logger)
{
    public async Task<WebhookRelayTestResponse> RunAsync(
        CancellationToken cancellationToken = default)
    {
        var relayOptions = options.Value;
        if (!relayOptions.Enabled)
            return Failed("The webhook relay is not configured for this deployment.");
        if (!control.Enabled)
            return Failed("The webhook relay is disabled in integration settings.");

        var httpBaseUrl = GetHttpBaseUrl(relayOptions);
        if (httpBaseUrl is null || string.IsNullOrWhiteSpace(relayOptions.InstallationId) ||
            string.IsNullOrWhiteSpace(relayOptions.Token))
            return Failed("The webhook relay test endpoint is not configured.");

        var testId = Guid.NewGuid().ToString("N");
        tracker.Register(testId);
        try
        {
            var endpoint = new Uri(
                httpBaseUrl,
                $"test/{Uri.EscapeDataString(relayOptions.InstallationId)}/{testId}");
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", relayOptions.Token);
            using var response = await httpClientFactory
                .CreateClient()
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Webhook relay test request was rejected with status {StatusCode}.",
                    (int)response.StatusCode);
                return new WebhookRelayTestResponse
                {
                    Succeeded = false,
                    Message = $"The relay rejected the test request ({(int)response.StatusCode}).",
                    TestId = testId,
                    RelayStatusCode = (int)response.StatusCode
                };
            }

            var apiReceivedAt = await tracker.WaitForReceiptAsync(
                testId,
                TimeSpan.FromSeconds(10),
                cancellationToken);
            return apiReceivedAt.HasValue
                ? new WebhookRelayTestResponse
                {
                    Succeeded = true,
                    Message = "The relay delivered a test event and the API acknowledged it.",
                    TestId = testId,
                    RelayAccepted = true,
                    RelayStatusCode = (int)response.StatusCode,
                    ApiReceivedAt = apiReceivedAt
                }
                : new WebhookRelayTestResponse
                {
                    Succeeded = false,
                    Message = "The relay accepted the test event, but the API did not receive it within 10 seconds.",
                    TestId = testId,
                    RelayAccepted = true,
                    RelayStatusCode = (int)response.StatusCode
                };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(exception, "Webhook relay test request could not reach the relay.");
            return new WebhookRelayTestResponse
            {
                Succeeded = false,
                Message = "The API could not reach the webhook relay.",
                TestId = testId
            };
        }
        finally
        {
            tracker.Remove(testId);
        }
    }

    private static WebhookRelayTestResponse Failed(string message) => new()
    {
        Succeeded = false,
        Message = message
    };

    private static Uri? GetHttpBaseUrl(WebhookRelayOptions relayOptions)
    {
        if (relayOptions.HttpUrl is not null)
            return EnsureTrailingSlash(relayOptions.HttpUrl);
        if (relayOptions.Url is null)
            return null;

        var builder = new UriBuilder(relayOptions.Url)
        {
            Scheme = relayOptions.Url.Scheme == Uri.UriSchemeWss
                ? Uri.UriSchemeHttps
                : Uri.UriSchemeHttp,
            Path = "/",
            Query = string.Empty,
            Fragment = string.Empty
        };
        return EnsureTrailingSlash(builder.Uri);
    }

    private static Uri EnsureTrailingSlash(Uri value) =>
        new(value.ToString().TrimEnd('/') + "/");
}

public sealed class WebhookRelayTestResponse
{
    public bool Succeeded { get; init; }
    public string Message { get; init; } = string.Empty;
    public string? TestId { get; init; }
    public bool RelayAccepted { get; init; }
    public int? RelayStatusCode { get; init; }
    public DateTimeOffset? ApiReceivedAt { get; init; }
}
