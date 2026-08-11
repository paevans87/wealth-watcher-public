using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    public partial class SchemaRefactor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AppPreferences",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    GeneralJson = table.Column<string>(type: "text", nullable: false),
                    FeatureJson = table.Column<string>(type: "text", nullable: false),
                    ForecastJson = table.Column<string>(type: "text", nullable: false),
                    FireJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppPreferences", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AssetGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Color = table.Column<string>(type: "text", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    IsSystem = table.Column<bool>(type: "boolean", nullable: false),
                    ArchivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AssetKinds",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Color = table.Column<string>(type: "text", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    ValueShape = table.Column<string>(type: "text", nullable: false),
                    ArchivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetKinds", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ArchivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BudgetLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Cadence = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BudgetLines", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "IntegrationProviders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IntegrationProviders", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AssetKindGroups",
                columns: table => new
                {
                    AssetKindId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetGroupId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetKindGroups", x => new { x.AssetKindId, x.AssetGroupId });
                    table.ForeignKey(
                        name: "FK_AssetKindGroups_AssetGroups_AssetGroupId",
                        column: x => x.AssetGroupId,
                        principalTable: "AssetGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AssetKindGroups_AssetKinds_AssetKindId",
                        column: x => x.AssetKindId,
                        principalTable: "AssetKinds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AssetKindAssignments",
                columns: table => new
                {
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetKindId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetKindAssignments", x => new { x.AssetId, x.AssetKindId });
                    table.ForeignKey(
                        name: "FK_AssetKindAssignments_AssetKinds_AssetKindId",
                        column: x => x.AssetKindId,
                        principalTable: "AssetKinds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AssetKindAssignments_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AssetValueEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Time = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    Discriminator = table.Column<string>(type: "character varying(34)", maxLength: 34, nullable: false),
                    InvestedCapital = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    Mortgage = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    Positions = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetValueEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AssetValueEntries_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PropertyDetails",
                columns: table => new
                {
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PropertyDetails", x => x.AssetId);
                    table.ForeignKey(
                        name: "FK_PropertyDetails_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BudgetLineAssetMappings",
                columns: table => new
                {
                    BudgetLineId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BudgetLineAssetMappings", x => new { x.BudgetLineId, x.AssetId });
                    table.ForeignKey(
                        name: "FK_BudgetLineAssetMappings_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BudgetLineAssetMappings_BudgetLines_BudgetLineId",
                        column: x => x.BudgetLineId,
                        principalTable: "BudgetLines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "IntegrationConnections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IntegrationProviderId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    PollingIntervalMinutes = table.Column<int>(type: "integer", nullable: false),
                    OptionsJson = table.Column<string>(type: "text", nullable: false),
                    CredentialsCiphertext = table.Column<string>(type: "text", nullable: false),
                    LastTestedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IntegrationConnections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IntegrationConnections_IntegrationProviders_IntegrationProv~",
                        column: x => x.IntegrationProviderId,
                        principalTable: "IntegrationProviders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IntegrationAccounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IntegrationConnectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    AccountType = table.Column<string>(type: "text", nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    LastSeenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IntegrationAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IntegrationAccounts_IntegrationConnections_IntegrationConne~",
                        column: x => x.IntegrationConnectionId,
                        principalTable: "IntegrationConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SyncRuns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    IntegrationConnectionId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConnectionDisplayNameSnapshot = table.Column<string>(type: "text", nullable: false),
                    StartTime = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndTime = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    RecordsAdded = table.Column<int>(type: "integer", nullable: false),
                    LogMessage = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SyncRuns_IntegrationConnections_IntegrationConnectionId",
                        column: x => x.IntegrationConnectionId,
                        principalTable: "IntegrationConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ExternalValues",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IntegrationAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExternalValues", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExternalValues_IntegrationAccounts_IntegrationAccountId",
                        column: x => x.IntegrationAccountId,
                        principalTable: "IntegrationAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "IntegrationAccountAssetMappings",
                columns: table => new
                {
                    IntegrationAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IntegrationAccountAssetMappings", x => x.IntegrationAccountId);
                    table.ForeignKey(
                        name: "FK_IntegrationAccountAssetMappings_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IntegrationAccountAssetMappings_IntegrationAccounts_Integra~",
                        column: x => x.IntegrationAccountId,
                        principalTable: "IntegrationAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AssetValueEntrySources",
                columns: table => new
                {
                    AssetValueEntryId = table.Column<int>(type: "integer", nullable: false),
                    ExternalValueId = table.Column<Guid>(type: "uuid", nullable: true),
                    SyncRunId = table.Column<int>(type: "integer", nullable: true),
                    SourceKind = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetValueEntrySources", x => x.AssetValueEntryId);
                    table.ForeignKey(
                        name: "FK_AssetValueEntrySources_AssetValueEntries_AssetValueEntryId",
                        column: x => x.AssetValueEntryId,
                        principalTable: "AssetValueEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_AssetValueEntrySources_ExternalValues_ExternalValueId",
                        column: x => x.ExternalValueId,
                        principalTable: "ExternalValues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_AssetValueEntrySources_SyncRuns_SyncRunId",
                        column: x => x.SyncRunId,
                        principalTable: "SyncRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ExternalValueAssetMappings",
                columns: table => new
                {
                    ExternalValueId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExternalValueAssetMappings", x => x.ExternalValueId);
                    table.ForeignKey(
                        name: "FK_ExternalValueAssetMappings_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ExternalValueAssetMappings_ExternalValues_ExternalValueId",
                        column: x => x.ExternalValueId,
                        principalTable: "ExternalValues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssetGroups_Code",
                table: "AssetGroups",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssetKindAssignments_AssetId",
                table: "AssetKindAssignments",
                column: "AssetId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssetKindAssignments_AssetKindId",
                table: "AssetKindAssignments",
                column: "AssetKindId");

            migrationBuilder.CreateIndex(
                name: "IX_AssetKindGroups_AssetGroupId",
                table: "AssetKindGroups",
                column: "AssetGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_AssetKindGroups_AssetKindId",
                table: "AssetKindGroups",
                column: "AssetKindId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssetKinds_Code",
                table: "AssetKinds",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Assets_DisplayName",
                table: "Assets",
                column: "DisplayName");

            migrationBuilder.CreateIndex(
                name: "IX_AssetValueEntries_AssetId_Date_Time",
                table: "AssetValueEntries",
                columns: new[] { "AssetId", "Date", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_AssetValueEntrySources_ExternalValueId",
                table: "AssetValueEntrySources",
                column: "ExternalValueId");

            migrationBuilder.CreateIndex(
                name: "IX_AssetValueEntrySources_SyncRunId",
                table: "AssetValueEntrySources",
                column: "SyncRunId");

            migrationBuilder.CreateIndex(
                name: "IX_BudgetLineAssetMappings_AssetId",
                table: "BudgetLineAssetMappings",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_BudgetLineAssetMappings_BudgetLineId",
                table: "BudgetLineAssetMappings",
                column: "BudgetLineId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExternalValueAssetMappings_AssetId",
                table: "ExternalValueAssetMappings",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_ExternalValues_IntegrationAccountId_ExternalId",
                table: "ExternalValues",
                columns: new[] { "IntegrationAccountId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IntegrationAccountAssetMappings_AssetId",
                table: "IntegrationAccountAssetMappings",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_IntegrationAccounts_IntegrationConnectionId_ExternalId",
                table: "IntegrationAccounts",
                columns: new[] { "IntegrationConnectionId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IntegrationConnections_IntegrationProviderId_DisplayName",
                table: "IntegrationConnections",
                columns: new[] { "IntegrationProviderId", "DisplayName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IntegrationProviders_Code",
                table: "IntegrationProviders",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SyncRuns_IntegrationConnectionId",
                table: "SyncRuns",
                column: "IntegrationConnectionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppPreferences");

            migrationBuilder.DropTable(
                name: "AssetKindAssignments");

            migrationBuilder.DropTable(
                name: "AssetKindGroups");

            migrationBuilder.DropTable(
                name: "AssetValueEntrySources");

            migrationBuilder.DropTable(
                name: "BudgetLineAssetMappings");

            migrationBuilder.DropTable(
                name: "ExternalValueAssetMappings");

            migrationBuilder.DropTable(
                name: "IntegrationAccountAssetMappings");

            migrationBuilder.DropTable(
                name: "PropertyDetails");

            migrationBuilder.DropTable(
                name: "AssetGroups");

            migrationBuilder.DropTable(
                name: "AssetKinds");

            migrationBuilder.DropTable(
                name: "AssetValueEntries");

            migrationBuilder.DropTable(
                name: "SyncRuns");

            migrationBuilder.DropTable(
                name: "BudgetLines");

            migrationBuilder.DropTable(
                name: "ExternalValues");

            migrationBuilder.DropTable(
                name: "Assets");

            migrationBuilder.DropTable(
                name: "IntegrationAccounts");

            migrationBuilder.DropTable(
                name: "IntegrationConnections");

            migrationBuilder.DropTable(
                name: "IntegrationProviders");
        }
    }
}
