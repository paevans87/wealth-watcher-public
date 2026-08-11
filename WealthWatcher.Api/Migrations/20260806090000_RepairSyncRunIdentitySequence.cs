using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using WealthWatcher.Api.Data;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(WealthDbContext))]
    [Migration("20260806090000_RepairSyncRunIdentitySequence")]
    public partial class RepairSyncRunIdentitySequence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                SELECT setval(
                    pg_get_serial_sequence('"SyncRuns"', 'Id'),
                    COALESCE(MAX("Id"), 1),
                    MAX("Id") IS NOT NULL
                )
                FROM "SyncRuns";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Sequence state cannot be safely restored without knowing the
            // sequence value that existed before this repair.
        }
    }
}
