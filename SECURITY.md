# Security policy

## Supported versions

Before the first public release, only the current `main` branch is supported. After the first release, the latest tagged release is supported on a best-effort basis. `main` is a development branch and is not a supported release unless explicitly identified in release notes. Security fixes may be backported at the maintainer's discretion; there is no service-level agreement.

## Security boundary

Wealth Watcher is currently designed for a single trusted deployment. It has no built-in user authentication, authorization, or multi-tenant isolation. Do not publish the API or web service directly to the Internet. Put it behind a trusted network boundary and HTTPS termination until those controls are implemented and reviewed.

The application may contain financial data and encrypted provider credentials. Keep the database, Data Protection key ring, `.env` file, backups, logs, and observability systems private.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/paevans87/wealth-watcher/security/advisories/new). Include the affected version or commit, impact, reproduction steps, and any suggested mitigation. Do not open a public issue or include secrets and personal financial data in the report.

The maintainer will acknowledge a report as soon as practical, investigate it, and coordinate disclosure after a fix or mitigation is available.
