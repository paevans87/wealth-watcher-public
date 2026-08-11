using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Integrations;

public sealed class Trading212IntegrationAdapter : IIntegrationAdapter
{
    public const string ProviderKey = "trading212";

    private static readonly TimeSpan AccountSummaryRateLimit = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PositionsRateLimit = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaximumRetryDelay = TimeSpan.FromSeconds(30);
    private static readonly ProviderRateLimitRule ProviderRateLimit =
        new("provider", 1, TimeSpan.FromSeconds(1));
    private static readonly ProviderRateLimitRule AccountSummaryRateLimitRule =
        new("account-summary", 1, AccountSummaryRateLimit);
    private static readonly ProviderRateLimitRule PositionsRateLimitRule =
        new("positions", 1, PositionsRateLimit);

    private readonly HttpClient httpClient;
    private readonly ILogger<Trading212IntegrationAdapter> logger;
    private readonly IProviderRateLimiter rateLimiter;

    public Trading212IntegrationAdapter(
        HttpClient httpClient,
        ILogger<Trading212IntegrationAdapter> logger,
        IProviderRateLimiter? rateLimiter = null)
    {
        this.httpClient = httpClient;
        this.logger = logger;
        this.rateLimiter = rateLimiter ?? new NoOpProviderRateLimiter();
    }

    public string Key => ProviderKey;

    public IntegrationDescriptor Descriptor { get; } = new()
    {
        Key = ProviderKey,
        DisplayName = "Trading 212",
        Description = "Read-only account balances and portfolio positions from Trading 212.",
        Kind = IntegrationKind.Investment,
        DefaultPollingIntervalMinutes = 180,
        MinimumPollingIntervalMinutes = 5,
        CredentialFields =
        [
            new IntegrationFieldDescriptor
            {
                Key = "apiKey",
                Label = "API key",
                Description = "The key generated in Trading 212 API settings.",
                Required = true,
                Secret = true,
                Type = "password"
            },
            new IntegrationFieldDescriptor
            {
                Key = "apiSecret",
                Label = "API secret",
                Description = "Shown once by Trading 212 when the key pair is created.",
                Required = true,
                Secret = true,
                Type = "password"
            }
        ],
        OptionFields =
        [
            new IntegrationFieldDescriptor
            {
                Key = "environment",
                Label = "Environment",
                Description = "Use demo for testing or live for the real account.",
                Type = "select",
                DefaultValue = "live",
                Options =
                [
                    new IntegrationFieldOption { Value = "live", Label = "Live" },
                    new IntegrationFieldOption { Value = "demo", Label = "Demo" }
                ]
            },
            new IntegrationFieldDescriptor
            {
                Key = "enableXray",
                Label = "Portfolio X-Ray",
                Description = "Keep the optional position breakdown available in the dashboard.",
                Type = "checkbox",
                DefaultValue = "false"
            }
        ]
    };

    public async Task<IntegrationTestResult> TestAsync(
        IntegrationContext context,
        CancellationToken cancellationToken)
    {
        var summary = await GetSummaryAsync(context, cancellationToken);
        var account = ToExternalAccount(summary);
        return new IntegrationTestResult
        {
            Succeeded = true,
            Message = $"Connected to Trading 212 account {account.DisplayName} ({account.Currency}).",
            Accounts = [account]
        };
    }

    public async Task<IReadOnlyList<ExternalAccount>> DiscoverAccountsAsync(
        IntegrationContext context,
        CancellationToken cancellationToken)
    {
        var summary = await GetSummaryAsync(context, cancellationToken);
        return [ToExternalAccount(summary)];
    }

    public async Task<IntegrationPullResult> PullAsync(
        IntegrationContext context,
        IReadOnlyCollection<ExternalAccount> accounts,
        CancellationToken cancellationToken)
    {
        var result = new IntegrationPullResult();
        foreach (var account in accounts)
        {
            try
            {
                var summary = await GetSummaryAsync(context, cancellationToken);
                var enableXray = GetOption(context.Options, "enableXray", "false")
                    .Equals("true", StringComparison.OrdinalIgnoreCase);
                var positions = enableXray
                    ? await GetPositionsAsync(context, cancellationToken)
                    : [];
                var value = positions.Sum(position => position.CurrentValue);
                var investedCapital = positions.Sum(position => position.Quantity * position.AveragePrice);

                result.Values.Add(new ExternalValueSnapshot
                {
                    AccountExternalId = account.ExternalId,
                    ExternalValueId = $"account:{account.ExternalId}:investments",
                    Name = account.DisplayName,
                    Type = "investments",
                    Role = ExternalValueRole.Deployed,
                    Value = summary.TotalValue,
                    InvestedCapital = positions.Count == 0 ? null : investedCapital,
                    ObservedAt = DateTimeOffset.UtcNow,
                    Positions = positions
                });
                result.Summaries.Add(enableXray
                    ? $"{account.DisplayName}: {positions.Count} position(s), {value:0.00} position value"
                    : $"{account.DisplayName}: account balance pulled (X-Ray disabled)");
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                result.Errors.Add($"{account.DisplayName}: {exception.Message}");
                logger.LogWarning(exception, "Trading 212 pull failed for account {AccountId}.", account.ExternalId);
            }
        }

        return result;
    }

    private async Task<T212Summary> GetSummaryAsync(IntegrationContext context, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            context,
            HttpMethod.Get,
            "/api/v0/equity/account/summary",
            AccountSummaryRateLimit,
            cancellationToken);
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
            throw CreateRateLimitException(response, "account summary", AccountSummaryRateLimit);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Trading 212 account summary returned {(int)response.StatusCode}.");

        var summary = await response.Content.ReadFromJsonAsync<T212Summary>(cancellationToken: cancellationToken);
        if (summary is null || summary.Id == 0)
            throw new InvalidOperationException("Trading 212 returned an empty account summary.");
        return summary;
    }

    private async Task<List<ExternalPosition>> GetPositionsAsync(
        IntegrationContext context,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            context,
            HttpMethod.Get,
            "/api/v0/equity/positions",
            PositionsRateLimit,
            cancellationToken);
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
            throw CreateRateLimitException(response, "positions", PositionsRateLimit);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Trading 212 positions returned {(int)response.StatusCode}.");

        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
            return [];

        var positions = new List<ExternalPosition>();
        foreach (var item in document.RootElement.EnumerateArray())
        {
            var instrument = GetObject(item, "instrument");
            var ticker = GetString(instrument, "ticker") ?? GetString(item, "ticker") ?? "Unknown";
            var name = GetString(instrument, "name") ?? GetString(instrument, "shortName") ?? ticker;
            var quantity = GetDecimal(item, "quantity");
            var averagePrice = GetDecimal(item, "averagePricePaid") ?? GetDecimal(item, "averagePrice") ?? 0m;
            var currentPrice = GetDecimal(item, "currentPrice") ?? 0m;

            positions.Add(new ExternalPosition
            {
                Ticker = ticker,
                Name = name,
                Quantity = quantity ?? 0m,
                AveragePrice = averagePrice,
                CurrentPrice = currentPrice,
                CurrentValue = (quantity ?? 0m) * currentPrice
            });
        }

        return positions;
    }

    private async Task<HttpResponseMessage> SendAsync(
        IntegrationContext context,
        HttpMethod method,
        string path,
        TimeSpan rateLimitFallback,
        CancellationToken cancellationToken)
    {
        var environment = GetOption(context.Options, "environment", "live").Equals("demo", StringComparison.OrdinalIgnoreCase)
            ? "demo"
            : "live";
        var apiKey = RequiredCredential(context, "apiKey");
        var apiSecret = RequiredCredential(context, "apiSecret");
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{apiKey}:{apiSecret}"));

        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = new HttpRequestMessage(method, $"https://{environment}.trading212.com{path}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.UserAgent.ParseAdd("WealthWatcher/1.0");

            var rateLimitRules = GetRateLimitRules(path);
            await rateLimiter.WaitAsync(ProviderKey, rateLimitRules, cancellationToken);
            var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            rateLimiter.Observe(ProviderKey, rateLimitRules, response);
            if (response.StatusCode != HttpStatusCode.TooManyRequests || attempt == 1)
                return response;

            var retryDelay = GetRetryDelay(response, rateLimitFallback);
            response.Dispose();
            await Task.Delay(retryDelay, cancellationToken);
        }

        throw new InvalidOperationException("Trading 212 request could not be completed.");
    }

    private static IReadOnlyList<ProviderRateLimitRule> GetRateLimitRules(string path) =>
        path.Equals("/api/v0/equity/account/summary", StringComparison.OrdinalIgnoreCase)
            ? [ProviderRateLimit, AccountSummaryRateLimitRule]
            : path.Equals("/api/v0/equity/positions", StringComparison.OrdinalIgnoreCase)
                ? [ProviderRateLimit, PositionsRateLimitRule]
                : [ProviderRateLimit];

    private static InvalidOperationException CreateRateLimitException(
        HttpResponseMessage response,
        string resource,
        TimeSpan fallback)
    {
        var delay = GetRetryDelay(response, fallback);
        var seconds = Math.Max(1, (int)Math.Ceiling(delay.TotalSeconds));
        return new InvalidOperationException(
            $"Trading 212 rate limit reached for {resource}. Try again in about {seconds} second{(seconds == 1 ? string.Empty : "s")}.");
    }

    private static TimeSpan GetRetryDelay(HttpResponseMessage response, TimeSpan fallback)
    {
        if (response.Headers.RetryAfter is { } retryAfter)
        {
            if (retryAfter.Delta is { } delta && delta >= TimeSpan.Zero)
                return LimitRetryDelay(delta);

            if (retryAfter.Date is { } date)
                return LimitRetryDelay(date - DateTimeOffset.UtcNow);
        }

        if (response.Headers.TryGetValues("x-ratelimit-reset", out var resetValues) &&
            long.TryParse(resetValues.FirstOrDefault(), out var resetUnixSeconds))
        {
            var resetAt = DateTimeOffset.FromUnixTimeSeconds(resetUnixSeconds);
            return LimitRetryDelay(resetAt - DateTimeOffset.UtcNow);
        }

        return LimitRetryDelay(fallback);
    }

    private static TimeSpan LimitRetryDelay(TimeSpan delay) =>
        delay <= TimeSpan.Zero
            ? TimeSpan.Zero
            : delay > MaximumRetryDelay
                ? MaximumRetryDelay
                : delay;

    private static ExternalAccount ToExternalAccount(T212Summary summary) => new()
    {
        ExternalId = summary.Id.ToString(),
        DisplayName = $"Trading 212 account {summary.Id}",
        AccountType = "Invest / Stocks ISA",
        Currency = summary.Currency ?? string.Empty
    };

    private static string RequiredCredential(IntegrationContext context, string key) =>
        context.Credentials.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"Missing Trading 212 credential '{key}'.");

    private static string GetOption(JsonElement options, string key, string fallback) =>
        options.ValueKind == JsonValueKind.Object &&
        options.TryGetProperty(key, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback
            : fallback;

    private static JsonElement GetObject(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : default;

    private static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static decimal? GetDecimal(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Number &&
        value.TryGetDecimal(out var number)
            ? number
            : null;

    private sealed class T212Summary
    {
        public long Id { get; set; }
        public string? Currency { get; set; }
        public decimal TotalValue { get; set; }
    }
}
