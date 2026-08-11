using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using WealthWatcher.Api.Migrations;
using Xunit;

namespace WealthWatcher.Api.Tests;

public sealed class SyncRunIdentitySequenceMigrationTests
{
    [Fact]
    public void Migration_repairs_identity_sequence_from_the_highest_imported_sync_run_id()
    {
        var migrationBuilder = new MigrationBuilder("Npgsql.EntityFrameworkCore.PostgreSQL");
        new ExposedRepairMigration().Apply(migrationBuilder);

        var sql = Assert.Single(migrationBuilder.Operations.OfType<SqlOperation>()).Sql;

        Assert.Contains("pg_get_serial_sequence('\"SyncRuns\"', 'Id')", sql, StringComparison.Ordinal);
        Assert.Contains("COALESCE(MAX(\"Id\"), 1)", sql, StringComparison.Ordinal);
        Assert.Contains("MAX(\"Id\") IS NOT NULL", sql, StringComparison.Ordinal);
    }

    private sealed class ExposedRepairMigration : RepairSyncRunIdentitySequence
    {
        public void Apply(MigrationBuilder migrationBuilder) => Up(migrationBuilder);
    }
}
