# Wealth Watcher

Wealth Watcher is a self-hosted personal wealth dashboard for recording assets, tracking net worth, modelling forecasts, managing budgets, and optionally synchronising supported providers.

> **Status:** The original project code and documentation are licensed under the [MIT License](LICENSE). This is a local/trusted-network, single-user application with no built-in authentication, authorization, or tenant isolation. Do not expose the API or dashboard directly to the public Internet.

## What it does

- Tracks cash, investments, pensions, property, and other classified assets.
- Shows historical values, calendar views, forecasts, FIRE progress, and budgets.
- Stores integration credentials encrypted with ASP.NET Core Data Protection.
- Supports optional Trading 212 and SnapTrade integrations.
- Keeps the primary financial database local to the deployment; provider traffic is outbound only when configured.

Forecasts are illustrative estimates based on the inputs and assumptions shown in the application. Wealth Watcher is not financial advice.

## Requirements

- .NET SDK 10.0.110 (see [global.json](global.json)).
- Node.js 24.13.0 (see [.nvmrc](.nvmrc)).
- Docker and Docker Compose for the containerised setup.
- PostgreSQL 15 or a compatible PostgreSQL service for production mode.

## Run locally for development

The development API uses an in-memory database, so this path is safe for a quick evaluation and does not require PostgreSQL.

Start the API in one terminal:

```powershell
dotnet run --project WealthWatcher.Api --environment Development --urls http://127.0.0.1:5200
```

Start the Vite UI in another terminal:

```powershell
npm ci --prefix WealthWatcher.UI
npm run dev --prefix WealthWatcher.UI -- --host 127.0.0.1 --port 5173
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to the development API at `http://127.0.0.1:5200`.

## Run with Docker Compose

Copy the example configuration, replace the placeholder database password, and keep the file private:

```powershell
Copy-Item .env.example .env
# Edit .env and set POSTGRES_PASSWORD to a long random value.
docker compose config
docker compose up --build
```

Open <http://127.0.0.1:8182>. The database, API, and web ports bind to loopback by default. Set the `*_BIND_ADDRESS` values in `.env` only when a trusted-network deployment needs a different interface.

The `CONFIG_PATH` directory contains the Data Protection key ring used to decrypt stored integration credentials. Treat it as sensitive application data, back it up securely, and do not commit it.

## Configuration

Compose configuration is supplied through a private `.env` file. The supported variables are documented in [.env.example](.env.example). For a direct API process, use standard ASP.NET Core environment-variable configuration, for example `ConnectionStrings__DefaultConnection` and `Cors__AllowedOrigins__0`.

Provider setup guidance is in [WealthWatcher.Api/Integrations/docs/adding-integrations.md](WealthWatcher.Api/Integrations/docs/adding-integrations.md). Never place provider credentials in source code, issue reports, screenshots, logs, or committed configuration.

## Verify changes

From the repository root:

```powershell
dotnet test WealthWatcher.Api.Tests/WealthWatcher.Api.Tests.csproj
npm ci --prefix WealthWatcher.UI
npm test --prefix WealthWatcher.UI
npm run build --prefix WealthWatcher.UI
docker compose config
```

The public pull-request workflow repeats the API and UI checks and validates both Docker builds.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Vulnerabilities must be reported privately using the process in [SECURITY.md](SECURITY.md), not through a public issue.

## License and release readiness

Original project code and documentation are released under the [MIT License](LICENSE). Third-party packages, Docker images, provider APIs, provider data, names, logos, and other external material remain subject to their own terms; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Release and versioning rules are documented in [RELEASE_POLICY.md](RELEASE_POLICY.md). The initial public release is planned as `v0.1.0`; the UI package remains private and is not published as an npm library.

The project owner retains sole responsibility for merge decisions, release approval, and changing the release boundary.
