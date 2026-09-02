using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIntegrationSyncModeAndRelaySetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "WebhookRelayEnabled",
                table: "AppPreferences",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SyncMode",
                table: "IntegrationConnections",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            // SnapTrade webhook delivery was already active before connections
            // gained an explicit mode. Preserve that behavior for existing
            // SnapTrade connections; newly created connections default to poll.
            migrationBuilder.Sql("""
                UPDATE "IntegrationConnections" connection
                SET "SyncMode" = 2
                FROM "IntegrationProviders" provider
                WHERE connection."IntegrationProviderId" = provider."Id"
                  AND lower(provider."Code") = 'snaptrade';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WebhookRelayEnabled",
                table: "AppPreferences");

            migrationBuilder.DropColumn(
                name: "SyncMode",
                table: "IntegrationConnections");
        }
    }
}
