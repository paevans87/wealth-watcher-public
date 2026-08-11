# Third-party notices

This file is an implementation inventory for release review. It is not a legal certification, and the owner must verify the final licenses and notices before selecting a project license or changing repository visibility.

## .NET application dependencies

The API uses the following direct package dependencies. Their package metadata and repositories are the authoritative sources for the applicable notices and license text:

- [Microsoft.AspNetCore.OpenApi](https://github.com/dotnet/aspnetcore) — OpenAPI support.
- [Microsoft.EntityFrameworkCore](https://github.com/dotnet/efcore) and [Npgsql](https://github.com/npgsql/efcore.pg) — data access and PostgreSQL provider.
- [Serilog.AspNetCore](https://github.com/serilog/serilog-aspnetcore) — logging.
- [SnapTrade.Net](https://github.com/passiv/snaptrade-dotnet) — SnapTrade integration client.
- [Swashbuckle.AspNetCore](https://github.com/domaindrivendev/Swashbuckle.AspNetCore) — Swagger/OpenAPI UI.

The resolved transitive dependency graph is produced during restore. Before a release, generate a complete transitive license report and retain it with the release artifacts.

## UI dependencies

- [Chart.js](https://github.com/chartjs/Chart.js) — charts.
- [chartjs-plugin-datalabels](https://github.com/chartjs/chartjs-plugin-datalabels) — chart labels.
- [flatpickr](https://github.com/flatpickr/flatpickr) — date inputs.
- [pluralize](https://github.com/plurals/pluralize) — pluralisation helpers.
- [Vite](https://github.com/vitejs/vite) — development server and production bundler.

The UI resolves runtime assets through `WealthWatcher.UI/package-lock.json`; it does not load JavaScript, CSS, or fonts from third-party CDNs at runtime.

## Container images

The Docker setup uses images published by Microsoft, PostgreSQL, Node.js, and Nginx. Their image manifests and distribution licenses must be reviewed for the exact tags used by each release.

## Provider names and services

Trading 212, SnapTrade, PostgreSQL, and other referenced product names and services remain the property of their respective owners. This project is independent and must not imply provider endorsement. Review each provider's API terms, branding rules, SDK license, and data-handling requirements before release.

Relevant provider terms include the [Trading 212 API Terms](https://www.trading212.com/legal-documentation/API-Terms_EN.pdf), [SnapTrade Developer Terms of Use](https://snaptrade.com/developer-terms-of-use), and [SnapTrade End User Terms and Conditions](https://snaptrade.com/terms-and-conditions). These terms are separate from the project MIT licence and may impose account, consent, data-handling, compliance, or usage requirements.

## Review process

Run the dependency checks in the public CI workflow, inspect direct and transitive package metadata, and update this inventory whenever a dependency or externally hosted asset changes.
