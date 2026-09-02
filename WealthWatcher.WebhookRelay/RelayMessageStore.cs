using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace WealthWatcher.WebhookRelay;

public enum RelayMessageState
{
    Pending = 0,
    InFlight = 1,
    Delivered = 2
}

public sealed class RelayMessage
{
    public required string MessageId { get; init; }
    public required string InstallationId { get; init; }
    public required string Provider { get; init; }
    public string? EventType { get; init; }
    public required DateTimeOffset ReceivedAt { get; init; }
    public required IReadOnlyDictionary<string, string> Headers { get; init; }
    public required string PayloadJson { get; init; }
    public int Attempts { get; init; }
}

public sealed class RelayEnqueueResult
{
    public required bool Added { get; init; }
    public required string MessageId { get; init; }
}

public interface IRelayMessageStore
{
    Task InitializeAsync(CancellationToken cancellationToken = default);

    Task<bool> CanConnectAsync(CancellationToken cancellationToken = default);

    Task<RelayEnqueueResult> EnqueueAsync(
        RelayMessage message,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<RelayMessage>> GetDueAsync(
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken = default);

    Task<int?> MarkAttemptAsync(
        RelayMessage message,
        CancellationToken cancellationToken = default);

    Task MarkDeliveredAsync(
        RelayMessage message,
        CancellationToken cancellationToken = default);

    Task RescheduleAsync(
        RelayMessage message,
        DateTimeOffset nextAttemptAt,
        string error,
        CancellationToken cancellationToken = default);

    Task RecoverInFlightAsync(CancellationToken cancellationToken = default);

    Task RemoveExpiredAsync(
        DateTimeOffset olderThan,
        CancellationToken cancellationToken = default);
}

public sealed class RelayMessageStore : IRelayMessageStore
{
    private readonly string connectionString;

    public RelayMessageStore(string connectionString)
    {
        var builder = new SqliteConnectionStringBuilder(connectionString)
        {
            // The relay is intentionally small and opens short-lived connections
            // per queue operation. Disabling pooling makes file ownership and
            // backup/restore behaviour deterministic for a standalone container.
            Pooling = false
        };
        this.connectionString = builder.ToString();
    }

    private const string CreateTableSql = """
        CREATE TABLE IF NOT EXISTS RelayMessages (
            MessageId TEXT NOT NULL,
            InstallationId TEXT NOT NULL,
            Provider TEXT NOT NULL,
            EventType TEXT NULL,
            ReceivedAt TEXT NOT NULL,
            HeadersJson TEXT NOT NULL,
            PayloadJson TEXT NOT NULL,
            State INTEGER NOT NULL,
            Attempts INTEGER NOT NULL,
            NextAttemptAt INTEGER NOT NULL,
            LastError TEXT NULL,
            CreatedAt TEXT NOT NULL,
            AcknowledgedAt TEXT NULL,
            PRIMARY KEY (InstallationId, Provider, MessageId)
        );
        CREATE INDEX IF NOT EXISTS IX_RelayMessages_Due
            ON RelayMessages (State, NextAttemptAt);
        CREATE INDEX IF NOT EXISTS IX_RelayMessages_Retention
            ON RelayMessages (State, AcknowledgedAt);
        """;

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        EnsureDirectoryExists();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var command = connection.CreateCommand())
        {
            command.CommandText = CreateTableSql;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await RecoverInFlightAsync(cancellationToken);
    }

    public async Task<bool> CanConnectAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            EnsureDirectoryExists();
            await using var connection = await OpenConnectionAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1;";
            return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) == 1;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
    }

    public async Task<RelayEnqueueResult> EnqueueAsync(
        RelayMessage message,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO RelayMessages
                (MessageId, InstallationId, Provider, EventType, ReceivedAt,
                 HeadersJson, PayloadJson, State, Attempts, NextAttemptAt,
                 LastError, CreatedAt, AcknowledgedAt)
            VALUES
                ($messageId, $installationId, $provider, $eventType, $receivedAt,
                 $headersJson, $payloadJson, $state, 0, $nextAttemptAt,
                 NULL, $createdAt, NULL)
            ON CONFLICT (InstallationId, Provider, MessageId) DO NOTHING;
            """;
        command.Parameters.AddWithValue("$messageId", message.MessageId);
        command.Parameters.AddWithValue("$installationId", message.InstallationId);
        command.Parameters.AddWithValue("$provider", message.Provider);
        command.Parameters.AddWithValue("$eventType", (object?)message.EventType ?? DBNull.Value);
        command.Parameters.AddWithValue("$receivedAt", message.ReceivedAt.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue(
            "$headersJson",
            JsonSerializer.Serialize(message.Headers));
        command.Parameters.AddWithValue("$payloadJson", message.PayloadJson);
        command.Parameters.AddWithValue("$state", (int)RelayMessageState.Pending);
        command.Parameters.AddWithValue("$nextAttemptAt", message.ReceivedAt.ToUnixTimeSeconds());
        command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
        var added = await command.ExecuteNonQueryAsync(cancellationToken) > 0;
        return new RelayEnqueueResult { Added = added, MessageId = message.MessageId };
    }

    public async Task<IReadOnlyList<RelayMessage>> GetDueAsync(
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT MessageId, InstallationId, Provider, EventType, ReceivedAt,
                   HeadersJson, PayloadJson, Attempts
            FROM RelayMessages
            WHERE State = $state AND NextAttemptAt <= $now
            ORDER BY NextAttemptAt, CreatedAt
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$state", (int)RelayMessageState.Pending);
        command.Parameters.AddWithValue("$now", now.ToUnixTimeSeconds());
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 100));

        var messages = new List<RelayMessage>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            messages.Add(new RelayMessage
            {
                MessageId = reader.GetString(0),
                InstallationId = reader.GetString(1),
                Provider = reader.GetString(2),
                EventType = reader.IsDBNull(3) ? null : reader.GetString(3),
                ReceivedAt = DateTimeOffset.Parse(reader.GetString(4), CultureInfo.InvariantCulture),
                Headers = JsonSerializer.Deserialize<Dictionary<string, string>>(reader.GetString(5))
                          ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase),
                PayloadJson = reader.GetString(6),
                Attempts = reader.GetInt32(7)
            });
        }

        return messages;
    }

    public async Task<int?> MarkAttemptAsync(
        RelayMessage message,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using (var update = connection.CreateCommand())
        {
            update.CommandText = """
                UPDATE RelayMessages
                SET State = $inFlight, Attempts = Attempts + 1
                WHERE InstallationId = $installationId
                  AND Provider = $provider
                  AND MessageId = $messageId
                  AND State = $pending;
                """;
            AddMessageKey(update, message);
            update.Parameters.AddWithValue("$inFlight", (int)RelayMessageState.InFlight);
            update.Parameters.AddWithValue("$pending", (int)RelayMessageState.Pending);
            if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                return null;
        }

        await using var select = connection.CreateCommand();
        select.CommandText = """
            SELECT Attempts
            FROM RelayMessages
            WHERE InstallationId = $installationId
              AND Provider = $provider
              AND MessageId = $messageId;
            """;
        AddMessageKey(select, message);
        var value = await select.ExecuteScalarAsync(cancellationToken);
        return value is null or DBNull ? null : Convert.ToInt32(value, CultureInfo.InvariantCulture);
    }

    public async Task MarkDeliveredAsync(
        RelayMessage message,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE RelayMessages
            SET State = $delivered, AcknowledgedAt = $acknowledgedAt, LastError = NULL
            WHERE InstallationId = $installationId
              AND Provider = $provider
              AND MessageId = $messageId;
            """;
        AddMessageKey(command, message);
        command.Parameters.AddWithValue("$delivered", (int)RelayMessageState.Delivered);
        command.Parameters.AddWithValue("$acknowledgedAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RescheduleAsync(
        RelayMessage message,
        DateTimeOffset nextAttemptAt,
        string error,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE RelayMessages
            SET State = $pending, NextAttemptAt = $nextAttemptAt, LastError = $lastError
            WHERE InstallationId = $installationId
              AND Provider = $provider
              AND MessageId = $messageId;
            """;
        AddMessageKey(command, message);
        command.Parameters.AddWithValue("$pending", (int)RelayMessageState.Pending);
        command.Parameters.AddWithValue("$nextAttemptAt", nextAttemptAt.ToUnixTimeSeconds());
        command.Parameters.AddWithValue("$lastError", error[..Math.Min(error.Length, 512)]);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RecoverInFlightAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE RelayMessages
            SET State = $pending, NextAttemptAt = $now
            WHERE State = $inFlight;
            """;
        command.Parameters.AddWithValue("$pending", (int)RelayMessageState.Pending);
        command.Parameters.AddWithValue("$inFlight", (int)RelayMessageState.InFlight);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RemoveExpiredAsync(
        DateTimeOffset olderThan,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            DELETE FROM RelayMessages
            WHERE State = $delivered AND AcknowledgedAt < $olderThan;
            """;
        command.Parameters.AddWithValue("$delivered", (int)RelayMessageState.Delivered);
        command.Parameters.AddWithValue("$olderThan", olderThan.ToUniversalTime().ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private void EnsureDirectoryExists()
    {
        var dataSource = new SqliteConnectionStringBuilder(connectionString).DataSource;
        if (string.IsNullOrWhiteSpace(dataSource) ||
            dataSource.Equals(":memory:", StringComparison.OrdinalIgnoreCase) ||
            dataSource.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            return;

        var directory = Path.GetDirectoryName(Path.GetFullPath(dataSource));
        if (!string.IsNullOrWhiteSpace(directory))
            Directory.CreateDirectory(directory);
    }

    private static void AddMessageKey(SqliteCommand command, RelayMessage message)
    {
        command.Parameters.AddWithValue("$installationId", message.InstallationId);
        command.Parameters.AddWithValue("$provider", message.Provider);
        command.Parameters.AddWithValue("$messageId", message.MessageId);
    }
}
