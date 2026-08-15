using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WealthWatcher.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMilestoneSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "MilestoneJson",
                table: "AppPreferences",
                type: "text",
                nullable: false,
                defaultValue: "{\"targets\":[]}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MilestoneJson",
                table: "AppPreferences");
        }
    }
}
