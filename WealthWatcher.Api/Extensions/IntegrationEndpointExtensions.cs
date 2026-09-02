using WealthWatcher.Api.Integrations;
using WealthWatcher.Api.Integrations.Webhooks;

using WealthWatcher.Api.Models;
using Microsoft.Extensions.Options;

namespace WealthWatcher.Api.Extensions;

public static class IntegrationEndpointExtensions
{
    public static WebApplication MapIntegrationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/integrations/catalog", (IntegrationService service) =>
            Results.Ok(service.GetCatalog()));

        app.MapGet("/api/integrations", async (
            IntegrationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetConnectionsAsync(cancellationToken)));

        app.MapGet("/api/integrations/settings", async (
            IntegrationSettingsService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetMarketHoursAsync(cancellationToken)));

        app.MapGet("/api/integrations/webhook-relay/status", (
            WebhookRelayStatus status,
            WebhookRelayControl control,
            IOptions<WebhookRelayOptions> options) =>
            Results.Ok(status.Snapshot(options.Value, control)));

        app.MapPut("/api/integrations/webhook-relay/settings", async (
            WebhookRelaySettingsRequest request,
            WebhookRelaySettingsService service,
            WebhookRelayStatus status,
            WebhookRelayControl control,
            IOptions<WebhookRelayOptions> options,
            CancellationToken cancellationToken) =>
        {
            try
            {
                await service.SaveEnabledAsync(request.Enabled, cancellationToken);
                return Results.Ok(status.Snapshot(options.Value, control));
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }
        });

        app.MapPost("/api/integrations/webhook-relay/test", async (
            WebhookRelayTestService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.RunAsync(cancellationToken)));

        app.MapPut("/api/integrations/settings", async (
            MarketHoursSettings request,
            IntegrationSettingsService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                return Results.Ok(await service.SaveMarketHoursAsync(request, cancellationToken));
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }
        });

        app.MapPost("/api/integrations/{providerKey}", async (
            string providerKey,
            IntegrationConnectionCreateRequest request,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var connection = await service.CreateConnectionAsync(
                    providerKey,
                    request.DisplayName,
                    cancellationToken);
                var response = (await service.GetConnectionsAsync(cancellationToken))
                    .Single(connectionResponse => connectionResponse.Id == connection.Id);
                return Results.Created($"/api/integrations/{connection.Id}", response);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.NotFound(new { Error = exception.Message });
            }
            catch (InvalidOperationException exception)
            {
                return Results.Conflict(new { Error = exception.Message });
            }
        });

        app.MapDelete("/api/integrations/{id:guid}", async (
            Guid id,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            var deleted = await service.DeleteConnectionAsync(id, cancellationToken);
            return deleted
                ? Results.NoContent()
                : Results.NotFound(new { Error = "Integration connection not found." });
        });

        app.MapPut("/api/integrations/{id:guid}/credentials", async (
            Guid id,
            IntegrationCredentialsRequest request,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await service.SaveCredentialsAsync(
                    id,
                    request.Credentials,
                    cancellationToken);
                if (response is null)
                    return Results.NotFound(new { Error = "Integration connection not found." });

                if (request.Options is not null)
                {
                    response = await service.UpdateConnectionAsync(
                        id,
                        new IntegrationConnectionUpdate { Options = request.Options },
                        cancellationToken);
                }

                return Results.Ok(response);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }
        });

        app.MapPost("/api/integrations/{id:guid}/test", async (
            Guid id,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            var response = await service.TestAsync(id, cancellationToken);
            return response is null
                ? Results.NotFound(new { Error = "Integration connection not found." })
                : Results.Ok(response);
        });

        app.MapPost("/api/integrations/{id:guid}/accounts/discover", async (
            Guid id,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            var response = await service.DiscoverAccountsAsync(id, cancellationToken);
            return response is null
                ? Results.NotFound(new { Error = "Integration connection not found." })
                : Results.Ok(response);
        });

        app.MapPut("/api/integrations/{id:guid}", async (
            Guid id,
            IntegrationConnectionUpdate request,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await service.UpdateConnectionAsync(id, request, cancellationToken);
                return response is null
                    ? Results.NotFound(new { Error = "Integration connection not found." })
                    : Results.Ok(response);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }
        });

        app.MapPatch("/api/integrations/{id:guid}", async (
            Guid id,
            IntegrationConnectionUpdate request,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await service.UpdateConnectionAsync(id, request, cancellationToken);
                return response is null
                    ? Results.NotFound(new { Error = "Integration connection not found." })
                    : Results.Ok(response);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }
        });

        app.MapPut("/api/integrations/{id:guid}/accounts/{accountId:guid}/allocation", async (
            Guid id,
            Guid accountId,
            IntegrationAccountAllocationRequest request,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var role = ParseAllocationRole(request.Role);
                IntegrationAccountResponse? response;
                if (request.Clear)
                {
                    response = await service.ClearAccountAllocationAsync(
                        id,
                        accountId,
                        role,
                        cancellationToken);
                }
                else if (request.AssetId.HasValue)
                {
                    response = await service.AllocateAccountAsync(
                        id,
                        accountId,
                        request.AssetId.Value,
                        role,
                        cancellationToken);
                }
                else
                {
                    response = await service.CreateAndAllocateAccountAsync(
                        id,
                        accountId,
                        request.AssetName ?? string.Empty,
                        request.EntryKind,
                        request.AssetKindId,
                        role,
                        cancellationToken);
                }

                return response is null
                    ? Results.NotFound(new { Error = "Integration account not found." })
                    : Results.Ok(response);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { Error = exception.Message });
            }
        });

        app.MapPost("/api/integrations/{id:guid}/sync", async (
            Guid id,
            IntegrationService service,
            CancellationToken cancellationToken) =>
        {
            var response = await service.SyncAsync(id, cancellationToken);
            return response is null
                ? Results.NotFound(new { Error = "Integration connection not found." })
                : Results.Ok(response);
        });

        return app;
    }

    private static ExternalValueRole ParseAllocationRole(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            value.Equals(nameof(ExternalValueRole.Deployed), StringComparison.OrdinalIgnoreCase))
            return ExternalValueRole.Deployed;
        if (value.Equals(nameof(ExternalValueRole.Undeployed), StringComparison.OrdinalIgnoreCase))
            return ExternalValueRole.Undeployed;

        throw new ArgumentException($"Unsupported integration asset allocation role '{value}'.");
    }
}

public sealed class IntegrationConnectionCreateRequest
{
    public string? DisplayName { get; init; }
}

public sealed class IntegrationCredentialsRequest
{
    public Dictionary<string, string> Credentials { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string>? Options { get; init; }
}

public sealed class IntegrationAccountAllocationRequest
{
    public Guid? AssetId { get; init; }
    public string? AssetName { get; init; }
    public Guid? AssetKindId { get; init; }
    public string? EntryKind { get; init; }
    public string? Role { get; init; }
    public bool Clear { get; init; }
}

public sealed class WebhookRelaySettingsRequest
{
    public bool Enabled { get; init; }
}
