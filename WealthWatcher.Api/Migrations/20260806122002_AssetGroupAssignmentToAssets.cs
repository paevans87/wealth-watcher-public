using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    public partial class AssetGroupAssignmentToAssets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AssetGroupId",
                table: "Assets",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "Assets" AS asset
                SET "AssetGroupId" = mapping."AssetGroupId"
                FROM "AssetKindAssignments" AS assignment
                INNER JOIN "AssetKindGroups" AS mapping
                    ON mapping."AssetKindId" = assignment."AssetKindId"
                WHERE asset."Id" = assignment."AssetId";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Assets_AssetGroupId",
                table: "Assets",
                column: "AssetGroupId");

            migrationBuilder.AddForeignKey(
                name: "FK_Assets_AssetGroups_AssetGroupId",
                table: "Assets",
                column: "AssetGroupId",
                principalTable: "AssetGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Assets_AssetGroups_AssetGroupId",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_Assets_AssetGroupId",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "AssetGroupId",
                table: "Assets");
        }
    }
}
