# Release policy

This policy applies to the planned public Wealth Watcher repository and its self-managed, local/trusted-network application boundary.

## Versioning

- Use Semantic Versioning for application releases.
- The first public release is `0.1.0`, published with the annotated Git tag `v0.1.0`.
- While the major version is `0`, a minor release may still contain breaking changes. Release notes must call out migrations, configuration changes, and upgrade risks.
- Move to `1.0.0` only when the application, data migrations, deployment procedure, and support expectations are considered stable.
- `main` is the development branch. The latest tagged release is the supported release; support is best-effort with no service-level agreement.

## Release contents

Each release should include:

- a GitHub release with concise release notes and a `CHANGELOG.md` entry;
- the exact Git tag and source archive;
- SHA-256 checksums for the source archive and any published release artefacts; and
- an SBOM for the application dependency graph.

The project owner retains responsibility for dependency, security, provider-integration, and release decisions.

## Local Docker deployment

Container images are a local implementation detail of the self-managed Docker Compose deployment. They are built and run locally by each installation and will never be published to a container registry.

There is therefore no public container image tag, digest, registry credential, or container provenance/attestation contract. The Git tag and source archive remain the release identity; users build the local images from that tagged source repository.

## UI package

`WealthWatcher.UI` is an application bundle, not a reusable npm library. Its package remains marked `private` and is not published to npm. Its package version tracks the application release, beginning at `0.1.0`, so build metadata remains consistent with the application release.

## Support and security

Support is limited to the latest tagged release on a best-effort basis. Vulnerabilities must be reported privately through the process in `SECURITY.md`; public issues should not contain credentials, account identifiers, or personal financial data. The local/trusted-network boundary and its deployment responsibilities remain documented separately from this release policy.
