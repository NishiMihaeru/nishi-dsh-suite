# Nishi DSH Suite

`nishi-dsh-suite` is the single Market-facing bundle for the modular Nishi integrations for DeepSeek Harness.

Compatibility target: **DeepSeek Harness 0.1.1-rc.2**, Node.js 24, pnpm 11.21.0 for development.

## Runtime modules

Installing this bundle brings the exact `0.1.0-rc.1` prerelease family:

- `nishi-dsh-codex` — Codex primary/subagent integration;
- `nishi-dsh-antigravity` — Antigravity primary/subagent integration through `agy`;
- `nishi-dsh-claude-code` — Claude Code subagent through the official Agent SDK;
- `nishi-dsh-primary-web-search` — the single `web_search` tool routed by the active primary provider;
- `nishi-dsh-project-memory` — project-scoped DSH memory and memory tools;
- `nishi-dsh-usage-limits` — normalized usage/limits domain library;
- `nishi-dsh-usage-limits-host` — host/RPC/browser Usage & Limits integration;
- `nishi-dsh-codex-usage-source` — official Codex app-server rate-limit source adapter.

`cordis.patch.yml` mounts only host-plane plugins: Project Memory, the three managed provider packages, and Usage Limits Host. `nishi-dsh-primary-web-search` remains an installed dependency but is mounted on the **agent plane** by the Orchestrator preset, matching DSH Web's rc.2 ownership model. The usage domain and Codex usage source are library dependencies and are not Cordis rows.

## Authentication boundary

The Suite does not install vendor clients and does not copy vendor OAuth/session/token databases. Codex, Claude Code, and Antigravity continue to use their vendor-owned local runtimes and authentication state.

## Orchestrator preset

The npm package contains the accepted Orchestrator preset under `presets/orchestrator`. Both `preset.yml` and `agent.cordis.yml` are included in the package `files` contract and exported as package subpaths, so the artifact is ready for a supported DSH preset-root seam when one exists.

Automatic third-party preset-root discovery is **not enabled by this bundle on DSH 0.1.1-rc.2**. The rc.2 CLI composition overwrites third-party `agent-presets.config.roots` with the shipped preset root at runtime, so adding such a row here would look configured but would not reliably work. The preset remains an upstream-gated acceptance item until DSH exposes a stable bundle seam or fixes that root override.

No startup copier, service monkeypatch, or mutation of `$DSH_HOME/.agent-presets` is hidden in this package.

## Development status

This package is a prerelease migration target. Static composition is present in the public repository; executable install/check/test/build acceptance still requires a regenerated workspace lockfile and an available runner/local environment.
