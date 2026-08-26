# Nishi DSH Suite bundle acceptance

Status: **STATIC_COMPLETE / EXECUTION_PENDING**

## Manifest

`packages/suite/package.json` defines:

- package `nishi-dsh-suite@0.1.0-rc.1`;
- Node.js `>=24 <25`;
- `dsh.bundle.patch = ./cordis.patch.yml`;
- exact workspace prerelease dependencies on all eight Nishi packages;
- packaged Orchestrator YAML under `presets/orchestrator`, included in `files` and exported as package subpaths.

The workspace protocol is intentional for repository development and must be verified during `pnpm pack` to produce exact registry versions in the packed manifest before prerelease publication.

## Bundle rows and ownership

`packages/suite/cordis.patch.yml` mounts exactly these **host-plane** runtime plugins once:

- `nishi-dsh-project-memory`
- `nishi-dsh-codex`
- `nishi-dsh-antigravity`
- `nishi-dsh-claude-code`
- `nishi-dsh-usage-limits-host`

These packages are installed dependencies but are not host Cordis rows:

- `nishi-dsh-primary-web-search` — agent-plane tool mounted by the packaged Orchestrator preset;
- `nishi-dsh-usage-limits` — domain library;
- `nishi-dsh-codex-usage-source` — Codex usage source library.

The search ownership is deliberate. DSH rc.2 `dsh-base` defines a stock `tool-web`, and the web bundle disables the host copy because model-facing tools are owned by agent presets. Mounting a second global `web_search` plugin from the Suite would violate that ownership and risk duplicate/shadowed tool registration.

The old combined `nishi-dsh-codex-antigravity` package is not part of the bundle.

## Orchestrator

`packages/suite/presets/orchestrator` is part of the package artifact. The remaining blocker is discovery, not packaging: the bundle intentionally does not patch `agent-presets.config.roots` on DSH 0.1.1-rc.2 because the rc.2 CLI runtime overwrites third-party roots. See `docs/acceptance/orchestrator.md` and issue #2.

## Verification status

Static manifest and patch contract tests are present in `packages/suite/test`, including assertions that the preset files are part of the Suite package contract.

Executable `pnpm test`, `pnpm pack`, DSH profile install, update, and uninstall verification remain pending until a local runner is available and the workspace lockfile is regenerated. GitHub-hosted Actions are currently externally blocked by the account billing lock.

Do not interpret this document as evidence that the executable gates have passed.
