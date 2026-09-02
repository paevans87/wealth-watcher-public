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

### Optional webhook relay

The relay is an optional, separate container for provider webhook delivery. It is useful when a SnapTrade holdings update should trigger a refresh before the normal polling interval, but it is not needed for a standard installation.

1. Create a private API/relay pairing id and a long random relay token. Use the same pair in the relay's `RELAY_INSTALLATION_ID`/`RELAY_TOKEN` settings and the API's `WEBHOOK_RELAY_INSTALLATION_ID`/`WEBHOOK_RELAY_TOKEN` settings. This pairing id is internal; it is not part of the provider webhook URL.
2. Configure the relay's `SNAPTRADE_CONSUMER_KEY` with the same SnapTrade consumer key used by the API integration. This lets the public boundary verify SnapTrade's `Signature` header before queueing the event.
3. Put `docker-compose.relay.yml` behind an HTTPS/WSS-capable reverse proxy, then set `RELAY_BIND_ADDRESS` and `RELAY_PORT` as appropriate for that proxy.
4. Start it independently:

   ```sh
   docker compose -f docker-compose.relay.yml up -d
   ```

5. Set `WEBHOOK_RELAY_ENABLED=true`, `WEBHOOK_RELAY_URL=wss://<relay-host>/ws`, and optionally `WEBHOOK_RELAY_HTTP_URL=https://<relay-host>` and `WEBHOOK_RELAY_PUBLIC_BASE_URL=https://<relay-host>` in the private stack, restart the API, and register `https://<relay-host>/webhooks/snaptrade` with SnapTrade. Each self-hosted deployment has its own relay host, so the host—not an installation path segment—identifies where the provider should deliver events. The HTTP URL is used only by the Integrations screen's relay-to-API diagnostic and is derived from the WebSocket URL when omitted. The public base URL must be the relay's externally reachable HTTPS address (for example an ngrok URL), not the Wealth Watcher API address; it lets the provider's webhook reach the relay and lets the Integrations screen display the exact registration URL. It is not used for relay authentication.

Keep the relay SQLite data directory and all tokens private. The API and database should remain bound to the private host; only the relay needs a provider-facing route. The Integrations screen controls the relay's user-facing enabled state, and each connection must use either webhook delivery or scheduled polling. Polling remains available when the relay is disabled, disconnected, or unavailable.

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
