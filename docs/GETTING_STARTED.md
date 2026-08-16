# Getting Started

Wealth Watcher is a local-first, single-user dashboard for tracking assets, net worth, budgets, forecasts, and financial independence. The quickest way to evaluate it is the [fictional live demo](https://wealthwatcher.co.uk/demo/); it needs no account, API, database, or provider connection.

## Recommended path: Docker Compose

This path runs the database, API, and web UI together. You do not need the .NET SDK or Node.js installed on the host.

### 1. Install the prerequisites

Install Docker Desktop on Windows or macOS, or Docker Engine with the Compose plugin on Linux. Check that Compose is available:

```sh
docker compose version
```

### 2. Get the repository

Clone the repository and open a terminal in its root directory:

```sh
git clone https://github.com/paevans87/wealth-watcher-public.git
cd wealth-watcher-public
```

### 3. Create the private configuration

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS or Linux:

```sh
cp .env.example .env
```

Edit `.env` and replace `POSTGRES_PASSWORD` with a long random password. Keep `.env`, the `config` directory, database backups, and provider credentials private. Do not commit them or paste them into an issue or support request.

Validate the Compose file without printing the resolved configuration, which can include the database password:

```sh
docker compose config --quiet
```

### 4. Start Wealth Watcher

```sh
docker compose up -d --build
```

Open [http://127.0.0.1:8182](http://127.0.0.1:8182). To follow startup logs while diagnosing a problem, run:

```sh
docker compose logs -f api db web
```

You can stop the services without deleting your database with:

```sh
docker compose down
```

### 5. Add your first asset

The initial dashboard is empty by design:

1. Open **Settings**.
2. Expand **Asset Catalogue**.
3. Select **Add asset** and create your first holding.
4. Record a value for the asset, or configure a supported integration.
5. Return to **Dashboard** to see net worth, allocation, and history.

The supported provider integrations are currently Trading 212 and SnapTrade. Provider connections are optional; manual assets work without them.

## Local development path

Use this path when you are changing the code. It uses an in-memory database and does not require PostgreSQL.

### Prerequisites

- .NET SDK `10.0.302`, as pinned in [global.json](../global.json).
- Node.js `24.13.0`, as pinned in [.nvmrc](../.nvmrc).

Start the API in one terminal:

```sh
dotnet run --project WealthWatcher.Api --environment Development --urls http://127.0.0.1:5200
```

Install UI dependencies and start Vite in another terminal:

```sh
npm ci --prefix WealthWatcher.UI
npm run dev --prefix WealthWatcher.UI -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The UI proxies `/api` requests to the development API.

## Health check and troubleshooting

The Compose API health endpoint should return HTTP 200 with a status of `ok`:

PowerShell:

```powershell
(Invoke-WebRequest http://127.0.0.1:8182/api/health).Content
```

macOS or Linux:

```sh
curl http://127.0.0.1:8182/api/health
```

If the health check fails, inspect `docker compose logs api db` and confirm that the password in `.env` is set and the ports in `.env` are not already in use. Do not include logs containing credentials or private financial data when asking for help.

For backups, restores, and upgrades, see the [Operations guide](OPERATIONS.md). For safe setup questions or reproducible defects, see the [Support policy](../SUPPORT.md). Report security vulnerabilities privately using the [Security policy](../SECURITY.md).

## Safety boundary

Wealth Watcher has no built-in authentication, authorization, or tenant isolation. Keep the API and dashboard on the local machine or a trusted network. Do not expose them directly to the public Internet unless you add and review the required authentication, HTTPS, and network controls.

Forecasts are illustrative estimates based on the inputs and assumptions shown in the application. Wealth Watcher is not financial advice.
