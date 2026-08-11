# Open-source export manifest

This is a dry-run export policy for creating the planned fresh public repository. It is not a public-release approval and it does not change the current repository, its history, or its visibility.

## Default export

Start from the selected `main` commit and include its Git-tracked files except for the explicit exclusions below. The export must be initialized as a new repository with one reviewed initial commit; do not copy `.git`, branches, tags, pull-request refs, Actions artifacts, or other repository metadata.

Run `scripts/Test-OpenSourceExport.ps1` from the source checkout before creating the new repository. Review its excluded-file list and any secret-pattern or historical-path findings.

## Explicit exclusions

These files are excluded by default because they contain owner-only deployment material or legacy audit output:

- `OPEN_SOURCE_DEPLOYMENT.md`
- `.github/workflows/deploy.yml`
- `DatabaseSchemaDefinitions.html`
- `UIInputAudit.html`
- `DatabaseSchemaAudit.html`
- `ForecastCalculationsSummary.html`
- `OPEN_SOURCE_READINESS.md` and `OPEN_SOURCE_MIGRATION.md`, which are owner-only release and migration notes
- `.env`, `config/`, database files, backups, logs, and local key material

The first four paths are tracked in the legacy repository, so `.gitignore` alone is not sufficient when assembling the export. The export must use this explicit policy or an equivalent reviewed allowlist.

## Final review

Before changing visibility, review the staged file list and confirm that it contains no secrets, personal financial data, private deployment configuration, historical repository metadata, or unreviewed generated output. Then run the API tests, UI tests, UI build, and Docker Compose configuration validation against the exported repository.
