using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace WealthWatcher.Api.Integrations.Webhooks;

public sealed class WebhookRelayWorker(
    IOptions<WebhookRelayOptions> options,
    IWebhookDispatcher dispatcher,
    WebhookRelayStatus status,
    WebhookRelayControl control,
    WebhookRelayTestTracker testTracker,
    IServiceScopeFactory scopeFactory,
    ILogger<WebhookRelayWorker> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var relayOptions = options.Value;
        if (!relayOptions.Enabled)
        {
            status.MarkDisabled();
            return;
        }

        try
        {
            await control.LoadPersistedStateAsync(scopeFactory, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }
        catch (Exception exception)
        {
            // A missing or unreadable preference should not prevent the
            // deployment-level relay connection from starting.
            logger.LogWarning(exception, "Unable to load the persisted webhook relay setting; using the deployment default.");
        }

        var retryDelay = TimeSpan.FromSeconds(1);
        while (!stoppingToken.IsCancellationRequested)
        {
            if (!control.Enabled)
            {
                status.MarkDisabled();
                await control.WaitUntilEnabledAsync(stoppingToken);
                retryDelay = TimeSpan.FromSeconds(1);
                continue;
            }

            try
            {
                status.MarkConnecting();
                using var socket = new ClientWebSocket();
                socket.Options.SetRequestHeader("Authorization", $"Bearer {relayOptions.Token}");
                socket.Options.SetRequestHeader("X-WealthWatcher-Installation", relayOptions.InstallationId);
                await socket.ConnectAsync(relayOptions.Url!, stoppingToken);
                status.MarkConnected(DateTimeOffset.UtcNow);
                retryDelay = TimeSpan.FromSeconds(1);
                logger.LogInformation("Webhook relay connection established.");

                await ReceiveLoopUntilClosedOrDisabledAsync(socket, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Webhook relay connection failed or was closed.");
            }
            finally
            {
                status.MarkDisconnected();
            }

            if (stoppingToken.IsCancellationRequested)
                break;

            if (!control.Enabled)
                continue;

            var jitter = TimeSpan.FromMilliseconds(Random.Shared.Next(0, 500));
            var delay = retryDelay + jitter;
            logger.LogInformation("Webhook relay reconnect scheduled in {DelaySeconds:0.0} seconds.", delay.TotalSeconds);
            await Task.Delay(delay, stoppingToken);
            retryDelay = retryDelay >= TimeSpan.FromSeconds(60)
                ? TimeSpan.FromSeconds(60)
                : TimeSpan.FromSeconds(Math.Min(60, retryDelay.TotalSeconds * 2));
        }
    }

    private async Task ReceiveLoopUntilClosedOrDisabledAsync(
        ClientWebSocket socket,
        CancellationToken stoppingToken)
    {
        using var connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        using var controlWaitCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var receiveTask = ReceiveLoopAsync(socket, connectionCancellation.Token);
        try
        {
            while (!receiveTask.IsCompleted)
            {
                var changeTask = control.WaitForChangeAsync(controlWaitCancellation.Token);
                var completed = await Task.WhenAny(receiveTask, changeTask);
                if (completed == receiveTask)
                {
                    controlWaitCancellation.Cancel();
                    break;
                }

                if (!control.Enabled)
                {
                    connectionCancellation.Cancel();
                    try
                    {
                        await receiveTask;
                    }
                    catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
                    {
                    }

                    return;
                }

                if (stoppingToken.IsCancellationRequested)
                {
                    connectionCancellation.Cancel();
                    await receiveTask;
                    return;
                }
            }

            await receiveTask;
        }
        finally
        {
            controlWaitCancellation.Cancel();
        }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        while (socket.State == WebSocketState.Open)
        {
            var message = await ReceiveTextAsync(socket, cancellationToken);
            if (message is null)
                return;

            using var document = JsonDocument.Parse(message);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("type", out var typeElement) ||
                typeElement.ValueKind != JsonValueKind.String)
                continue;

            switch (typeElement.GetString())
            {
                case WebhookMessageTypes.Webhook:
                    await ProcessWebhookAsync(socket, root, cancellationToken);
                    break;
                case WebhookMessageTypes.Ping:
                    await SendAsync(socket, new RelayControlMessage { Type = WebhookMessageTypes.Pong }, cancellationToken);
                    break;
            }
        }
    }

    private async Task ProcessWebhookAsync(
        ClientWebSocket socket,
        JsonElement root,
        CancellationToken cancellationToken)
    {
        RelayWebhookMessage? message;
        try
        {
            message = root.Deserialize<RelayWebhookMessage>(JsonOptions);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Webhook relay sent an invalid webhook message.");
            return;
        }

        if (message?.Event is null || string.IsNullOrWhiteSpace(message.MessageId))
            return;

        status.MarkMessageReceived(message.Event.ReceivedAt);
        try
        {
            WebhookDispatchResult result;
            if (WebhookRelayTestProtocol.TryReadTestId(message.Event, out var testId))
            {
                testTracker.MarkReceived(testId, message.Event.ReceivedAt);
                status.MarkTestReceived(testId, message.Event.ReceivedAt);
                result = new WebhookDispatchResult
                {
                    Status = WebhookDispatchStatus.Processed,
                    Message = "The relay diagnostic event was received by the API."
                };
            }
            else
            {
                result = await dispatcher.DispatchAsync(message.Event, cancellationToken);
            }

            if (!result.ShouldAcknowledge)
                return;

            await SendAsync(socket, new RelayAcknowledgement
            {
                MessageId = message.MessageId,
                Status = result.Status == WebhookDispatchStatus.Processed ? "processed" : "ignored"
            }, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // No ACK is intentional. The relay will retry this event after its
            // delivery timeout, preserving the existing provider sync path.
            logger.LogError(exception, "Webhook relay event processing failed for {MessageId}.", message.MessageId);
        }
    }

    private static async Task SendAsync(
        ClientWebSocket socket,
        object message,
        CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions);
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }

    private static async Task<string?> ReceiveTextAsync(
        ClientWebSocket socket,
        CancellationToken cancellationToken)
    {
        const int maxMessageBytes = 4 * 1024 * 1024;
        var buffer = new byte[8192];
        using var message = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
                return null;
            if (result.MessageType != WebSocketMessageType.Text)
                continue;

            if (message.Length + result.Count > maxMessageBytes)
                throw new InvalidOperationException("The webhook relay message exceeded the maximum size.");
            message.Write(buffer, 0, result.Count);
        }
        while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(message.ToArray());
    }
}
