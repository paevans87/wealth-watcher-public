using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WealthWatcher.WebhookRelay;

public sealed class RelayDeliveryResult
{
    public required bool Acknowledged { get; init; }
    public string? Status { get; init; }
}

public sealed class RelayConnection : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly WebSocket socket;
    private readonly SemaphoreSlim sendLock = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<RelayAcknowledgement>> acknowledgements = new(
        StringComparer.OrdinalIgnoreCase);

    public RelayConnection(string installationId, WebSocket socket)
    {
        InstallationId = installationId;
        this.socket = socket;
    }

    public string InstallationId { get; }

    public async Task<RelayDeliveryResult> DeliverAsync(
        RelayMessage message,
        TimeSpan acknowledgementTimeout,
        CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<RelayAcknowledgement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!acknowledgements.TryAdd(message.MessageId, completion))
        {
            return new RelayDeliveryResult { Acknowledged = false };
        }

        try
        {
            using var payloadDocument = JsonDocument.Parse(message.PayloadJson);
            var payload = JsonSerializer.SerializeToUtf8Bytes(
                new RelayWebhookMessage
                {
                    MessageId = message.MessageId,
                    Event = new RelayWebhookEnvelope
                    {
                        Id = message.MessageId,
                        Provider = message.Provider,
                        EventType = message.EventType,
                        ReceivedAt = message.ReceivedAt,
                        Headers = message.Headers,
                        Payload = payloadDocument.RootElement.Clone()
                    }
                },
                JsonOptions);
            await SendBytesAsync(payload, cancellationToken);

            var timeoutTask = Task.Delay(acknowledgementTimeout, cancellationToken);
            var completed = await Task.WhenAny(completion.Task, timeoutTask);
            if (completed != completion.Task)
            {
                cancellationToken.ThrowIfCancellationRequested();
                return new RelayDeliveryResult { Acknowledged = false };
            }

            var acknowledgement = await completion.Task;
            return new RelayDeliveryResult
            {
                Acknowledged = IsTerminalStatus(acknowledgement.Status),
                Status = acknowledgement.Status
            };
        }
        finally
        {
            acknowledgements.TryRemove(message.MessageId, out _);
        }
    }

    public bool TryAcknowledge(RelayAcknowledgement acknowledgement) =>
        acknowledgements.TryGetValue(acknowledgement.MessageId, out var completion) &&
        completion.TrySetResult(acknowledgement);

    public Task SendControlAsync(string type, CancellationToken cancellationToken) =>
        SendBytesAsync(
            JsonSerializer.SerializeToUtf8Bytes(new RelayControlMessage { Type = type }, JsonOptions),
            cancellationToken);

    public async Task RunReceiveLoopAsync(
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                    return;
                if (result.MessageType != WebSocketMessageType.Text)
                    continue;

                if (message.Length + result.Count > 64 * 1024)
                {
                    logger.LogWarning("A Wealth Watcher connection sent an oversized control message.");
                    return;
                }

                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (message.Length == 0)
                continue;

            try
            {
                using var document = JsonDocument.Parse(message.ToArray());
                var root = document.RootElement;
                if (!root.TryGetProperty("type", out var typeElement) ||
                    typeElement.ValueKind != JsonValueKind.String)
                    continue;

                switch (typeElement.GetString())
                {
                    case RelayMessageTypes.Ack:
                        var acknowledgement = root.Deserialize<RelayAcknowledgement>(JsonOptions);
                        if (acknowledgement is not null)
                            TryAcknowledge(acknowledgement);
                        break;
                    case RelayMessageTypes.Ping:
                        await SendControlAsync(RelayMessageTypes.Pong, cancellationToken);
                        break;
                }
            }
            catch (JsonException exception)
            {
                logger.LogWarning(exception, "A Wealth Watcher connection sent invalid relay protocol JSON.");
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var completion in acknowledgements.Values)
            completion.TrySetException(new WebSocketException("The Wealth Watcher connection closed."));
        acknowledgements.Clear();

        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await socket.CloseAsync(
                    WebSocketCloseStatus.NormalClosure,
                    "Relay connection closed",
                    CancellationToken.None);
            }
        }
        catch (WebSocketException)
        {
            // The peer may already have disconnected.
        }
        finally
        {
            socket.Dispose();
            sendLock.Dispose();
        }
    }

    private async Task SendBytesAsync(byte[] payload, CancellationToken cancellationToken)
    {
        await sendLock.WaitAsync(cancellationToken);
        try
        {
            if (socket.State != WebSocketState.Open)
                throw new WebSocketException("The Wealth Watcher connection is not open.");
            await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            sendLock.Release();
        }
    }

    private static bool IsTerminalStatus(string? status) =>
        string.Equals(status, "processed", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, "ignored", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase);
}

public sealed class RelayConnectionManager
{
    private readonly ConcurrentDictionary<string, RelayConnection> connections = new(
        StringComparer.OrdinalIgnoreCase);

    public async Task<RelayConnection> RegisterAsync(
        string installationId,
        WebSocket socket)
    {
        var connection = new RelayConnection(installationId, socket);
        if (connections.TryGetValue(installationId, out var existing))
        {
            connections[installationId] = connection;
            await existing.DisposeAsync();
        }
        else
        {
            connections.TryAdd(installationId, connection);
        }

        return connection;
    }

    public bool TryGet(string installationId, out RelayConnection? connection) =>
        connections.TryGetValue(installationId, out connection);

    public void Remove(RelayConnection connection)
    {
        ((ICollection<KeyValuePair<string, RelayConnection>>)connections)
            .Remove(new KeyValuePair<string, RelayConnection>(connection.InstallationId, connection));
    }
}

public static class RelayMessageTypes
{
    public const string Ack = "ack";
    public const string Ping = "ping";
    public const string Pong = "pong";
}

public sealed record RelayWebhookMessage
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = "webhook";

    [JsonPropertyName("messageId")]
    public required string MessageId { get; init; }

    [JsonPropertyName("event")]
    public required RelayWebhookEnvelope Event { get; init; }
}

public sealed record RelayWebhookEnvelope
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("provider")]
    public required string Provider { get; init; }

    [JsonPropertyName("eventType")]
    public string? EventType { get; init; }

    [JsonPropertyName("receivedAt")]
    public required DateTimeOffset ReceivedAt { get; init; }

    [JsonPropertyName("headers")]
    public IReadOnlyDictionary<string, string> Headers { get; init; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    [JsonPropertyName("payload")]
    public required JsonElement Payload { get; init; }
}

public sealed record RelayAcknowledgement
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = RelayMessageTypes.Ack;

    [JsonPropertyName("messageId")]
    public required string MessageId { get; init; }

    [JsonPropertyName("status")]
    public string? Status { get; init; }
}

public sealed record RelayControlMessage
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }
}
