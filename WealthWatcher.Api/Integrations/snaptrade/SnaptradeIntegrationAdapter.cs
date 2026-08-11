using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WealthWatcher.Api.Models;

namespace WealthWatcher.Api.Integrations;

public sealed class SnaptradeIntegrationAdapter : IIntegrationAdapter
{
    public const string ProviderKey = "snaptrade";

    private static readonly ProviderRateLimitRule CustomerRateLimit =
        new("customer", 250, TimeSpan.FromMinutes(1));
    private static readonly TimeSpan CustomerRetryFallback = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan AccountRetryFallback = TimeSpan.FromSeconds(6);
    private static readonly TimeSpan MaximumRetryDelay = TimeSpan.FromSeconds(30);

    private readonly HttpClient httpClient;
    private readonly ILogger<SnaptradeIntegrationAdapter> logger;
    private readonly IProviderRateLimiter rateLimiter;

    public SnaptradeIntegrationAdapter(
        HttpClient httpClient,
        ILogger<SnaptradeIntegrationAdapter> logger,
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
        DisplayName = "SnapTrade",
        Description = "Read account balances and positions from connected investment providers.",
        Kind = IntegrationKind.Investment,
        DefaultPollingIntervalMinutes = 180,
        MinimumPollingIntervalMinutes = 5,
        CredentialFields =
        [
            new IntegrationFieldDescriptor { Key = "clientId", Label = "Client ID", Required = true },
            new IntegrationFieldDescriptor { Key = "consumerKey", Label = "Consumer key", Required = true, Secret = true, Type = "password" },
            new IntegrationFieldDescriptor { Key = "userId", Label = "User ID", Required = false },
            new IntegrationFieldDescriptor { Key = "userSecret", Label = "User secret", Required = false, Secret = true, Type = "password" }
        ]
    };

    public async Task<IntegrationTestResult> TestAsync(
        IntegrationContext context,
        CancellationToken cancellationToken)
    {
        var accounts = await DiscoverAccountsAsync(context, cancellationToken);
        return new IntegrationTestResult
        {
            Succeeded = true,
            Message = $"Connected to SnapTrade. Found {accounts.Count} account(s).",
            Accounts = accounts
        };
    }

    public async Task<IReadOnlyList<ExternalAccount>> DiscoverAccountsAsync(
        IntegrationContext context,
        CancellationToken cancellationToken)
    {
        var accounts = await ReadAccountsAsync(context, cancellationToken);
        return accounts
            .Select(account => new ExternalAccount
            {
                ExternalId = account.ExternalId,
                DisplayName = account.DisplayName,
                AccountType = account.AccountType,
                Currency = account.Currency
            })
            .Where(account => !string.IsNullOrWhiteSpace(account.ExternalId))
            .ToList();
    }

    public async Task<IntegrationPullResult> PullAsync(
        IntegrationContext context,
        IReadOnlyCollection<ExternalAccount> accounts,
        CancellationToken cancellationToken)
    {
        var result = new IntegrationPullResult();
        var accountDetails = await ReadAccountsAsync(context, cancellationToken);
        var accountDetailsById = accountDetails.ToDictionary(
            account => account.ExternalId,
            StringComparer.OrdinalIgnoreCase);

        foreach (var account in accounts)
        {
            try
            {
                if (!accountDetailsById.TryGetValue(account.ExternalId, out var details))
                    throw new InvalidOperationException("The account was not returned by SnapTrade.");

                if (!details.TotalValue.HasValue)
                    throw new InvalidOperationException("SnapTrade did not return a total account value.");

                var cash = await ReadCashAsync(context, account.ExternalId, cancellationToken);
                var positions = await ReadPositionsAsync(context, account.ExternalId, cancellationToken);
                var observedAt = DateTimeOffset.UtcNow;
                var deployedValue = Math.Max(0m, details.TotalValue.Value - cash);
                result.Values.Add(new ExternalValueSnapshot
                {
                    AccountExternalId = account.ExternalId,
                    ExternalValueId = $"account:{account.ExternalId}:investments",
                    Name = account.DisplayName,
                    Type = "pensions",
                    Role = ExternalValueRole.Deployed,
                    Value = deployedValue,
                    InvestedCapital = positions.Count == 0 ? null : positions.Sum(position => position.Quantity * position.AveragePrice),
                    ObservedAt = observedAt,
                    Positions = positions
                });
                // Always emit the undeployed stream, including zero, so it can move
                // back to zero rather than retaining its previous balance. The stream
                // is mapped to the account Asset; Role preserves the distinction.
                result.Values.Add(new ExternalValueSnapshot
                {
                    AccountExternalId = account.ExternalId,
                    ExternalValueId = $"account:{account.ExternalId}:cash",
                    Name = account.DisplayName,
                    NameSuffix = " (undeployed)",
                    Type = "cash",
                    Role = ExternalValueRole.Undeployed,
                    Value = cash,
                    ObservedAt = observedAt
                });
                result.Summaries.Add(
                    $"{account.DisplayName}: {details.TotalValue.Value:0.##} total, {cash:0.##} undeployed cash, {positions.Count} position(s)");
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                result.Errors.Add($"{account.DisplayName}: {exception.Message}");
                logger.LogWarning(exception, "SnapTrade pull failed for account {AccountId}.", account.ExternalId);
            }
        }

        return result;
    }

    private async Task<List<SnapTradeAccountDetails>> ReadAccountsAsync(
        IntegrationContext context,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(context, HttpMethod.Get, "/api/v1/accounts", cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"SnapTrade accounts returned {(int)response.StatusCode}.");

        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
            return [];

        return document.RootElement.EnumerateArray()
            .Select(account => new SnapTradeAccountDetails
            {
                ExternalId = GetString(account, "id") ?? string.Empty,
                DisplayName = GetString(account, "name") ?? GetString(account, "institution_name") ?? "SnapTrade account",
                AccountType = GetString(account, "raw_type") ?? GetString(account, "type") ?? "Investment account",
                Currency = GetNestedString(account, ["meta", "currency"])
                    ?? GetNestedString(account, ["balance", "total", "currency"])
                    ?? GetString(account, "currency")
                    ?? string.Empty,
                TotalValue = GetNestedDecimal(account, ["balance", "total", "amount"])
            })
            .Where(account => !string.IsNullOrWhiteSpace(account.ExternalId))
            .ToList();
    }

    private async Task<decimal> ReadCashAsync(
        IntegrationContext context,
        string accountId,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(context, HttpMethod.Get, $"/api/v1/accounts/{accountId}/balances", cancellationToken);
        if (!response.IsSuccessStatusCode) return 0m;
        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Array) return 0m;
        return document.RootElement.EnumerateArray()
            .Sum(balance => GetDecimal(balance, "cash") ?? 0m);
    }

    private async Task<List<ExternalPosition>> ReadPositionsAsync(
        IntegrationContext context,
        string accountId,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(context, HttpMethod.Get, $"/api/v1/accounts/{accountId}/positions", cancellationToken);
        if (!response.IsSuccessStatusCode) return [];
        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        if (document.RootElement.ValueKind != JsonValueKind.Array) return [];

        return document.RootElement.EnumerateArray().Select(position =>
        {
            var ticker = GetNestedString(position, ["symbol", "symbol", "symbol"])
                         ?? GetNestedString(position, ["symbol", "symbol"])
                         ?? GetString(position, "symbol")
                         ?? "Unknown";
            var name = GetNestedString(position, ["symbol", "description"]) ?? ticker;
            var quantity = GetDecimal(position, "units") ?? 0m;
            var averagePrice = GetDecimal(position, "average_purchase_price") ?? 0m;
            var currentPrice = GetDecimal(position, "price") ?? 0m;
            return new ExternalPosition
            {
                Ticker = ticker,
                Name = name,
                Quantity = quantity,
                AveragePrice = averagePrice,
                CurrentPrice = currentPrice,
                CurrentValue = quantity * currentPrice
            };
        }).ToList();
    }

    private async Task<HttpResponseMessage> SendAsync(
        IntegrationContext context,
        HttpMethod method,
        string path,
        CancellationToken cancellationToken)
    {
        var clientId = RequiredCredential(context, "clientId");
        var consumerKey = RequiredCredential(context, "consumerKey");
        var rateLimitRules = GetRateLimitRules(path);
        var retryFallback = GetAccountId(path) is null
            ? CustomerRetryFallback
            : AccountRetryFallback;

        for (var attempt = 0; attempt < 2; attempt++)
        {
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            var query = $"clientId={clientId}&timestamp={timestamp}";
            var signatureContent = $"{{\"content\":null,\"path\":\"{path}\",\"query\":\"{query}\"}}";
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(consumerKey));
            var signature = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(signatureContent)));
            using var request = new HttpRequestMessage(method, $"https://api.snaptrade.com{path}?{query}");
            request.Headers.Add("Signature", signature);
            request.Headers.Accept.ParseAdd("application/json");

            await rateLimiter.WaitAsync(ProviderKey, rateLimitRules, cancellationToken);
            var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            rateLimiter.Observe(ProviderKey, rateLimitRules, response);
            if (response.StatusCode != HttpStatusCode.TooManyRequests || attempt == 1)
                return response;

            var retryDelay = GetRetryDelay(response, retryFallback);
            response.Dispose();
            await Task.Delay(retryDelay, cancellationToken);
        }

        throw new InvalidOperationException("SnapTrade request could not be completed.");
    }

    private static IReadOnlyList<ProviderRateLimitRule> GetRateLimitRules(string path)
    {
        var accountId = GetAccountId(path);
        return accountId is null
            ? [CustomerRateLimit]
            : [
                CustomerRateLimit,
                new ProviderRateLimitRule($"account:{accountId}", 10, TimeSpan.FromMinutes(1))
            ];
    }

    private static string? GetAccountId(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length >= 5 &&
               segments[0].Equals("api", StringComparison.OrdinalIgnoreCase) &&
               segments[1].Equals("v1", StringComparison.OrdinalIgnoreCase) &&
               segments[2].Equals("accounts", StringComparison.OrdinalIgnoreCase)
            ? segments[3]
            : null;
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

        foreach (var headerName in new[] { "x-ratelimit-reset", "x-ratelimit-account-reset" })
        {
            if (!response.Headers.TryGetValues(headerName, out var values) ||
                !long.TryParse(values.FirstOrDefault(), out var resetValue))
                continue;

            var delay = resetValue > 1_000_000_000
                ? DateTimeOffset.FromUnixTimeSeconds(resetValue) - DateTimeOffset.UtcNow
                : TimeSpan.FromSeconds(resetValue);
            return LimitRetryDelay(delay);
        }

        return LimitRetryDelay(fallback);
    }

    private static TimeSpan LimitRetryDelay(TimeSpan delay) =>
        delay <= TimeSpan.Zero
            ? TimeSpan.Zero
            : delay > MaximumRetryDelay
                ? MaximumRetryDelay
                : delay;

    private static string RequiredCredential(IntegrationContext context, string key) =>
        context.Credentials.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"Missing SnapTrade credential '{key}'.");

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

    private static string? GetNestedString(JsonElement element, IReadOnlyList<string> path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }
        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    private static decimal? GetNestedDecimal(JsonElement element, IReadOnlyList<string> path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }
        return current.ValueKind == JsonValueKind.Number && current.TryGetDecimal(out var number)
            ? number
            : null;
    }

    private sealed class SnapTradeAccountDetails
    {
        public string ExternalId { get; init; } = string.Empty;
        public string DisplayName { get; init; } = string.Empty;
        public string AccountType { get; init; } = string.Empty;
        public string Currency { get; init; } = string.Empty;
        public decimal? TotalValue { get; init; }
    }
}
