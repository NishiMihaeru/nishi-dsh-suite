# Nishi DSH Suite bundle acceptance

Status: **STATIC_COMPLETE / EXECUTION_PENDING**

## Manifest

`packages/suite/package.json` defines:

- package `nishi-dsh-suite@0.1.0-rc.1`;
- Node.js `>=24 <25`;
- `dsh.bundle.patch = ./cordis.patch.yml`;
- exact workspace prerelease dependencies on all eight Nishi packages.

The workspace protocol is intentional for repository development and must be verified during `pnpm pack` to produce exact registry versions in the packed manifest before prerelease publication.

## Bundle rows

`packages/suite/cordis.patch.yml` mounts exactly these runtime plugins once:

- `nishi-dsh-project-memory`
- `nishi-dsh-codex`
- `nishi-dsh-antigravity`
- `nishi-dsh-claude-code`
- `nishi-dsh-primary-web-search`
- `nishi-dsh-usage-limits-host`

These packages are dependencies but not Cordis rows:

- `nishi-dsh-usage-limits`
- `nishi-dsh-codex-usage-source`

The old combined `nishi-dsh-codex-antigravity` package is not part of the bundle.

## Orchestrator

The bundle intentionally does not patch `agent-presets.config.roots` on DSH 0.1.1-rc.2 because the rc.2 CLI runtime overwrites third-party roots. See `docs/acceptance/orchestrator.md`.

## Verification status

Static manifest and patch contract tests are present in `packages/suite/test`.

Executable `pnpm test`, `pnpm pack`, DSH profile install, update, and uninstall verification remain pending until a local runner is available and the workspace lockfile is regenerated. GitHub-hosted Actions are currently externally blocked by the account billing lock.

Do not interpret this document as evidence that the executable gates have passed.
