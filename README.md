# Nishi DSH Suite

Nishi DSH Suite is a public, modular extension suite for DeepSeek Harness distributed through the standard DSH plugin/bundle mechanism.

The migration targets DeepSeek Harness `0.1.1-rc.2`, Node.js 24, and one Market-facing package: `nishi-dsh-suite`.

## Modules

The Suite is split into independently owned runtime packages:

- `nishi-dsh-codex` — Codex primary/subagent integration;
- `nishi-dsh-antigravity` — Antigravity primary/subagent integration through the official `agy` client boundary;
- `nishi-dsh-claude-code` — Claude Code subagent integration through the official Agent SDK;
- `nishi-dsh-primary-web-search` — one `web_search` tool routed by the active Codex/Antigravity primary;
- `nishi-dsh-project-memory` — project-scoped Shared Project Memory;
- `nishi-dsh-usage-limits` — normalized usage/limits domain;
- `nishi-dsh-codex-usage-source` — Codex app-server rate-limit source;
- `nishi-dsh-usage-limits-host` — host/RPC/browser Usage & Limits integration.

`nishi-dsh-suite` is a thin composition bundle over those packages. It does not reimplement provider behavior.

## Distribution model

Normal installation is through DSH plugin reconciliation; there is no portable DSH home, custom runtime installer, cross-machine session sync, or cross-OS state migration.

Windows and CachyOS/Linux are independent supported installations. Project Memory stays inside each project checkout and is not transported by the Suite.

The prerelease family is currently `0.1.0-rc.1`. It is **not published yet**. Publication waits for deterministic build/test/pack gates and fresh Windows + CachyOS acceptance.

## Authentication boundary

Nishi DSH Suite does not install vendor clients and does not copy, broker, scrape, or replay vendor credentials.

- Codex authentication remains owned by the official `codex` client/App Server.
- Claude Code authentication remains owned by the official Claude Code/Agent SDK boundary.
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
- `subagent_claude_code`
- `subagent_antigravity`
- routed `web_search`

Automatic third-party preset discovery is currently blocked by the DSH `0.1.1-rc.2` launcher, which overwrites contributed preset roots with its shipped root after bundle/user overlays. The Suite does not hide this behind a startup copier or `$DSH_HOME/.agent-presets` mutation. Tracking: issue #2.

## Verification

Prepared repository gates:

```bash
corepack enable
pnpm install
pnpm verify:release-family
pnpm check
pnpm test
pnpm build
pnpm test:orchestrator
node scripts/pack-local.mjs
```

Executable gates have **not** been declared passing. GitHub-hosted Actions are currently unavailable because of an account billing lock; the workspace lockfile also needs regeneration in a real pnpm environment before frozen-lockfile CI can pass.

See `docs/acceptance/windows-cachyos.md` and `docs/release/prerelease.md` for the release gates.
