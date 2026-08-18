using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBudgetV2Document : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BudgetJson",
                table: "AppPreferences",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BudgetJson",
                table: "AppPreferences");
        }
    }
}
