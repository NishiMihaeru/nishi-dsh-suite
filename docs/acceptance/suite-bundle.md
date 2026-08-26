# Nishi DSH Suite bundle acceptance

Status: **STATIC_COMPLETE / EXECUTION_PENDING**

## Manifest

`packages/suite/package.json` defines:

- package `nishi-dsh-suite@0.1.0-rc.1`;
- Node.js `>=24 <25`;
- `dsh.bundle.patch = ./cordis.patch.yml`;
- exact workspace prerelease dependencies on all eight Nishi packages;
- exact `@deepseek-ai/dsh-authorization@0.1.1-rc.2` runtime dependency;
- packaged Orchestrator YAML under `presets/orchestrator`, included in `files` and exported as package subpaths;
- `nishi-dsh-suite` CLI binary at `lib/bin.js` for the explicit rc.2 preset lifecycle bridge.

The workspace protocol is intentional for repository development and must be verified during `pnpm pack` to produce exact registry versions in the packed manifest before prerelease publication.

## Bundle rows and ownership

`packages/suite/cordis.patch.yml` mounts exactly these **host-plane** runtime plugins once:

- `@deepseek-ai/dsh-authorization` — official rc.2 authorization service required by Usage Limits Host;
- `nishi-dsh-project-memory`;
- `nishi-dsh-codex`;
- `nishi-dsh-antigravity`;
- `nishi-dsh-claude-code`;
- `nishi-dsh-usage-limits-host`.

The authorization row is required because `nishi-dsh-usage-limits-host` injects `authorization`, while stock `dsh-base` and `dsh-web-app` rc.2 do not mount that service. This matches the accepted private profile, which explicitly mounted `@deepseek-ai/dsh-authorization` before Usage Limits Host.

These packages are installed dependencies but are not host Cordis rows:

- `nishi-dsh-primary-web-search` — agent-plane tool mounted by the packaged Orchestrator preset;
- `nishi-dsh-usage-limits` — domain library;
- `nishi-dsh-codex-usage-source` — Codex usage source library.

The search ownership is deliberate. DSH rc.2 `dsh-base` defines a stock `tool-web`, and the web bundle disables the host copy because model-facing tools are owned by agent presets. Mounting a second global `web_search` plugin from the Suite would violate that ownership and risk duplicate/shadowed tool registration.

The old combined `nishi-dsh-codex-antigravity` package is not part of the bundle.

## Orchestrator lifecycle on rc.2

`packages/suite/presets/orchestrator` is part of the package artifact. DSH rc.2 cannot automatically register the package preset root, so the Suite exposes an explicit CLI bridge into DSH's supported user preset root:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset update
dsh plugin --profile web exec nishi-dsh-suite preset remove
```

The only persistent bridge-owned directory is `$DSH_HOME/.agent-presets/orchestrator`. Atomic install/update may use transient stage/backup siblings under `.agent-presets`; successful operations remove them. Unmanaged or locally edited Orchestrator directories are refused rather than overwritten or removed.

Automatic one-click discovery remains tracked in issue #2. See `docs/acceptance/orchestrator.md`.

## Verification status

Static manifest/patch/preset-manager/CLI contract tests are present. `pnpm verify:local` is the one-shot local gate for release/package contracts, Orchestrator validation, TypeScript check, tests, build, and tarball creation.

Executable `pnpm verify:local`, DSH profile install/update/uninstall, preset lifecycle, and Windows/CachyOS acceptance remain pending until a real local/hosted runner is available and the workspace lockfile is regenerated. Current GitHub-hosted Actions fail before any job step starts because of the account billing lock.

Do not interpret this document as evidence that the executable gates have passed.
