# Nishi DSH Suite

Nishi DSH Suite is a public, modular extension suite for DeepSeek Harness distributed through the standard DSH plugin/bundle mechanism.

The migration targets DeepSeek Harness `0.1.1-rc.2`, Node.js 24, and one Market-facing package: `nishi-dsh-suite`.

## Modules

The Suite is split into independently owned runtime packages:

- `nishi-dsh-codex` — Codex primary/subagent integration with a `codex-app-server` provider compiled from the reviewed MIT `wingoo/codex-plugin-dsh` source snapshot pinned at `79fe7503390d641680bad8efade52782a3c31ced`;
- `nishi-dsh-antigravity` — Antigravity primary/subagent integration through the official `agy` client boundary;
- `nishi-dsh-primary-web-search` — one `web_search` tool routed by the active Codex/Antigravity primary;
- `nishi-dsh-project-memory` — project-scoped Shared Project Memory;
- `nishi-dsh-usage-limits` — normalized usage/limits domain;
- `nishi-dsh-codex-usage-source` — Codex app-server rate-limit source;
- `nishi-dsh-claude-usage-source` — Claude usage/limits source through the installed official `claude` CLI;
- `nishi-dsh-usage-limits-host` — host/RPC/browser Usage & Limits integration.

`nishi-dsh-suite` is a thin composition bundle over those packages. It does not reimplement provider behavior.

## Distribution model

Normal installation is through DSH plugin reconciliation; there is no portable DSH home, custom runtime installer, cross-machine session sync, or cross-OS state migration.

CachyOS/Linux has completed the full Node 24 live-runtime acceptance for the current prerelease. Windows is intentionally **not tested for `0.1.0-rc.1`** and no Windows compatibility claim is made for this prerelease. Project Memory stays inside each project checkout and is not transported by the Suite.

The nine-package prerelease family `0.1.0-rc.1` is published to npm and has passed a fresh registry-only DSH install/preset/remove smoke with no local tarball overrides. The documented prerelease channel is `next`, and exact-version installs are supported.

Because these are newly created npm packages, the registry also attached `latest` to the first published version and rejected authenticated attempts to remove that bootstrap tag. This does **not** represent a stable-release claim; see `docs/release/prerelease.md` for the recorded registry behavior.

## Authentication boundary

Nishi DSH Suite does not install vendor clients and does not copy, broker, scrape, or replay vendor credentials.

- Codex authentication remains owned by the official Codex CLI/App Server product boundary.
- Claude authentication remains owned by the installed official Claude Code CLI.
- Antigravity authentication remains owned by the official `agy` client.

A missing vendor client should disable only the corresponding integration rather than prevent DSH startup.

## Web search

The Suite intentionally has no DeepSeek/Exa/Perplexity fallback for its routed `web_search` tool:

- Codex primary → Codex-native search backend;
- Antigravity primary → `agy search_web` backend;
- unsupported primary → explicit unsupported error.

`DEEPSEEK_API_KEY` is not required by this routed search path.

## Orchestrator

The accepted Orchestrator preset is packaged inside the Market artifact at `packages/suite/presets/orchestrator` with fixed tools:

- `subagent_codex`
- `subagent_antigravity`
- routed `web_search`

Automatic third-party preset discovery is blocked by the DSH `0.1.1-rc.2` launcher, which overwrites contributed preset roots with its shipped root after bundle/user overlays. Tracking: issue #2.

For rc.2 the Suite provides an explicit managed bridge into DSH's supported user preset root:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

After a Suite update run `preset update`; before removing the Suite run `preset remove`. The only persistent directory owned by the bridge is `$DSH_HOME/.agent-presets/orchestrator`; atomic install/update may use transient stage/backup siblings under `.agent-presets`, which are removed after the operation. Unmanaged or locally edited `orchestrator` directories are never overwritten or removed automatically.

## Verification

Repository gates:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:local
```

`pnpm verify:local` runs release/package contracts, Orchestrator validation, TypeScript checks, tests, build, and local package creation.

The accepted source passed these gates locally under Node `24.19.0` / pnpm `11.21.0` on CachyOS, including fresh-profile prepublish install/reinstall/uninstall with the real Suite tarball and local leaf-package resolution. Full authenticated Codex, Antigravity, Project Memory, routed search, Usage & Limits, and uninstall/preservation live gates also pass on CachyOS.

The published `0.1.0-rc.1` family additionally passed a fresh public-registry-only DSH smoke: Suite resolution from npm, all eight exact leaf versions, managed Codex/Claude/DSH dependency versions, Orchestrator preset install/status/remove, and normal Suite removal. Evidence: `docs/acceptance/2026-08-27-registry-smoke.md`.

GitHub-hosted Actions are currently unavailable because jobs are blocked before execution by an account billing lock; no hosted-CI PASS is claimed.

See `docs/acceptance/windows-cachyos.md` and `docs/release/prerelease.md` for the exact scope and release gates.