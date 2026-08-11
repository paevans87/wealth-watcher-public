using System.Data;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using WealthWatcher.Api.Data;

namespace WealthWatcher.Api.Database;

internal static class LegacySchemaBridge
{
    private const string ScriptFileName = "20260806_schema_refactor.sql";

    public static bool IsRequired(WealthDbContext db)
    {
        var connection = db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;

        try
        {
            if (openedHere)
                connection.Open();

            using var command = connection.CreateCommand();
            command.CommandText = "SELECT to_regclass('public.\"WealthEntries\"') IS NOT NULL;";
            return Convert.ToBoolean(command.ExecuteScalar());
        }
        finally
        {
            if (openedHere)
                connection.Close();
        }
    }

    public static void Apply(WealthDbContext db)
    {
        var assembly = typeof(LegacySchemaBridge).Assembly;
        var resourceName = assembly
            .GetManifestResourceNames()
            .SingleOrDefault(name => name.EndsWith($".Database.{ScriptFileName}", StringComparison.OrdinalIgnoreCase));

        if (resourceName is null)
        {
            throw new InvalidOperationException(
                $"The embedded legacy schema bridge '{ScriptFileName}' was not found.");
        }

        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"The embedded legacy schema bridge '{ScriptFileName}' could not be opened.");
        using var reader = new StreamReader(stream);

        var connection = db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;

        try
        {
            if (openedHere)
                connection.Open();

            using var command = connection.CreateCommand();
            command.CommandText = reader.ReadToEnd();
            command.CommandTimeout = 300;
            command.ExecuteNonQuery();
        }
        finally
        {
            if (openedHere)
                connection.Close();
        }
    }
}
