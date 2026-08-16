# Changelog

All notable changes to this project will be documented here.

The latest prepared stable release is `v0.4.0`; the latest tagged release remains `v0.3.0` until this release is merged and tagged. Changes that have not yet been released are grouped under `Unreleased`.

## 0.4.0 - 2026-08-15

- Add optional wealth milestones with persisted multi-target settings and dashboard progress states.
- Harden integration boundaries and sanitize provider failure details before they cross API or persistence boundaries.
- Improve UI resilience and safe rendering for persisted settings, forecast validation, dashboard content, budget controls, integrations, and sync audits.
- Improve public-site SEO, social previews, privacy-aware analytics measurement, and Pages artifact validation.
- Pin container base images and runtime dependencies, and publish signed images with SBOM and provenance metadata.

## 0.3.0 - 2026-08-14

- Make the browser-only demo banner and app bar opaque, visible, and consistently layered.
- Improve mobile containment for high-data views and budget controls, with responsive layout regression coverage.
- Publish tagged stable images with a moving `latest` alias for the latest successful release.

## 0.2.0 - 2026-08-13

- Add the browser-only live demo and refreshed responsive public landing page.
- Add standardized loading, empty, and error states across the main application views.
- Add in-app version display, bundled release notes, and an informational update checker.
- Publish versioned API and web images through the public release workflow.

## Unreleased

- Prepare the repository for open-source release with public CI, dependency checks, contributor guidance, and safer local deployment defaults.
- Maintain the public release policy, version-aligned UI metadata, release notes, release checks, and application SBOMs; tagged Docker images are published to GHCR while deployment data remains local.
