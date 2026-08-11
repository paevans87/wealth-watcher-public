# Contributing to Wealth Watcher

Thanks for helping improve Wealth Watcher. Please keep changes small, explain user-visible behaviour, and protect financial and provider data in every contribution.

## Development setup

1. Install the .NET SDK and Node.js versions listed in the root `global.json` and `.nvmrc`.
2. Follow the local development steps in [README.md](README.md).
3. Do not commit `.env`, `config/`, database dumps, provider credentials, or personal financial data.

## Checks before opening a pull request

Run these commands from the repository root:

```powershell
dotnet test WealthWatcher.Api.Tests/WealthWatcher.Api.Tests.csproj
npm ci --prefix WealthWatcher.UI
npm test --prefix WealthWatcher.UI
npm run build --prefix WealthWatcher.UI
docker compose config
```

If you change a migration, verify it against a disposable PostgreSQL database and explain the upgrade and rollback considerations in the pull request. If you change an integration, update its documentation and tests without using live credentials.

## Branch naming

Human-created branches must use one of these prefixes followed by a short, lowercase, kebab-case description:

- `feature/<description>` for new functionality, documentation, UI, or site work.
- `bug/<description>` for defect fixes and regressions.

Examples: `feature/migrate-github-pages-site` and `bug/fix-forecast-rounding`. Automated branches created by GitHub services, such as Dependabot, are exempt from this naming convention.

## Pull requests

- Describe the problem, the approach, and how you verified it.
- Call out configuration, migration, security, privacy, or provider-impacting changes.
- Include screenshots or a short browser walkthrough for UI changes when useful; redact all financial values.
- Do not run untrusted pull-request code on a self-hosted deployment runner.
- Keep the public CI checks green and respond to review feedback before merging.

## Reporting issues

Use the issue templates for reproducible bugs and feature requests. Do not include credentials, account identifiers, private URLs, or real financial data. Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Maintainer policy

The project owner retains sole responsibility for deciding which pull requests are merged, when releases are made, and whether the local-only release boundary changes. A pull request is a discussion and is not an acceptance commitment.

There is no contributor licence agreement or copyright assignment requirement at this stage. Contributors must have the right to submit their work under the project's MIT licence and must not include third-party material they are not permitted to share.
