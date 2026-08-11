using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRoleSpecificIntegrationAssetMappings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                DECLARE primary_key_name text;
                BEGIN
                    SELECT constraint_name
                    INTO primary_key_name
                    FROM information_schema.table_constraints
                    WHERE table_schema = 'public'
                      AND table_name = 'IntegrationAccountAssetMappings'
                      AND constraint_type = 'PRIMARY KEY';

                    IF primary_key_name IS NOT NULL THEN
                        EXECUTE format(
                            'ALTER TABLE "IntegrationAccountAssetMappings" DROP CONSTRAINT %I',
                            primary_key_name);
                    END IF;
                END $$;
                """);

            migrationBuilder.AddColumn<int>(
                name: "Role",
                table: "IntegrationAccountAssetMappings",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddPrimaryKey(
                name: "PK_IntegrationAccountAssetMappings",
                table: "IntegrationAccountAssetMappings",
                columns: new[] { "IntegrationAccountId", "Role" });

            migrationBuilder.Sql("""
                UPDATE "IntegrationConnections" AS connection
                SET "Status" = 4
                FROM "IntegrationProviders" AS provider
                WHERE connection."IntegrationProviderId" = provider."Id"
                  AND lower(provider."Code") = 'snaptrade'
                  AND connection."Status" <> 6
                  AND EXISTS (
                      SELECT 1
                      FROM "IntegrationAccounts" AS account
                      WHERE account."IntegrationConnectionId" = connection."Id"
                        AND NOT EXISTS (
                            SELECT 1
                            FROM "IntegrationAccountAssetMappings" AS allocation
                            WHERE allocation."IntegrationAccountId" = account."Id"
                              AND allocation."Role" = 2
                        )
                  );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM \"IntegrationAccountAssetMappings\" WHERE \"Role\" <> 1;");

            migrationBuilder.DropPrimaryKey(
                name: "PK_IntegrationAccountAssetMappings",
                table: "IntegrationAccountAssetMappings");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "IntegrationAccountAssetMappings");

            migrationBuilder.AddPrimaryKey(
                name: "PK_IntegrationAccountAssetMappings",
                table: "IntegrationAccountAssetMappings",
                column: "IntegrationAccountId");
        }
    }
}
