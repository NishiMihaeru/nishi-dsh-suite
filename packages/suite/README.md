# Nishi DSH Suite

`nishi-dsh-suite` is the single Market-facing bundle for the modular Nishi integrations for DeepSeek Harness.

Compatibility target: **DeepSeek Harness 0.1.1-rc.2**, Node.js 24, pnpm 11.21.0 for development.

## Runtime modules

Installing this bundle brings the exact `0.1.0-rc.3` prerelease family: one provider-independent core plus one plugin per provider.

- `nishi-dsh-core` — the core: provider registry and connector, shared vendor CLI runtime, the routed `web_search` tool, the normalized usage/limits domain, and the host/RPC/browser Usage & Limits surface. It names no provider;
- `nishi-dsh-codex` — Codex primary provider (the `codex-app-server` route via pinned `codex-plugin-dsh`), with its native search backend and rate-limits source;
- `nishi-dsh-antigravity` — Antigravity primary provider through `agy`, with its native search backend and local usage source;
- `nishi-dsh-claude` — Claude usage and limits through the installed official `claude` CLI, and nothing else: no model route, no search;
- `nishi-dsh-project-memory` — project-scoped DSH memory and memory tools, provider-agnostic by construction.

The Suite also installs the official `@deepseek-ai/dsh-authorization@0.1.1-rc.2` service because the core injects `authorization` and stock rc.2 base/web profiles do not mount that service themselves.

`cordis.patch.yml` mounts the host plane: the official authorization seam, Project Memory, the core, and the three provider plugins. The routed `web_search` tool is mounted separately on the **agent plane** by the Orchestrator preset, as `nishi-dsh-core/web-search` — whether an agent can search at all is a preset choice, while the provider registry it resolves is a host-plane singleton.

Provider plugins inject the core's registry (`nishiProviders`), so cordis defers each one until the core row is mounted and unwinds its registration when the plugin is disposed. Adding a provider is adding a plugin: no edit to the core, the composition, or the browser.

## Authentication boundary

The authorization service is only the DSH service seam required by the Model Accounts/legacy-grant status surface. The Suite does not install vendor clients and does not copy vendor OAuth/session/token databases. Codex, Claude, and Antigravity continue to use their vendor-owned local runtimes and authentication state.

Delegation to vendor CLI agents was removed in `0.1.0-rc.3`: the `subagent_codex` and `subagent_antigravity` tools are gone, and the Orchestrator preset delegates through DSH's own `subagent` / `subagent_fork` on the session's primary route instead.

## Orchestrator preset on DSH 0.1.1-rc.2

The npm package contains the accepted Orchestrator preset under `presets/orchestrator`. Both `preset.yml` and `agent.cordis.yml` are included in the package `files` contract and exported as package subpaths.

DSH rc.2 includes `$DSH_HOME/.agent-presets` (default `~/.dsh/.agent-presets`) as its supported user preset root, but its launcher overwrites third-party bundle-contributed preset roots. Until upstream issue #2 is resolved, install the packaged preset explicitly after installing the Suite:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

After updating the Suite, refresh the managed copy with:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset update
```

Before removing the Suite from the profile, remove its managed user preset while the package is still present:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset remove
dsh plugin --profile web remove nishi-dsh-suite
```

The bridge's only persistent managed directory is `$DSH_HOME/.agent-presets/orchestrator`. Install/update use transient `.orchestrator.nishi-stage-*` and `.orchestrator.nishi-backup-*` sibling directories under the same user preset root for atomic replacement and clean them after the operation. The bridge stores a Suite ownership marker plus SHA-256 hashes and refuses to overwrite an unmanaged `orchestrator` or to update/remove one after local edits. It does not modify DSH profiles, sessions, Project Memory, or vendor credential stores.

The command is invoked through `dsh plugin --profile <profile> exec` rather than `npx`/`pnpm dlx`, so the executable comes from the exact Suite version installed in that DSH profile.

Automatic one-click discovery remains the upstream limitation; the explicit bridge is the supported temporary rc.2 path.

## Development status

This package is a prerelease migration target. `0.1.0-rc.3` is in-repo and unpublished; `0.1.0-rc.1` remains the published family on npm. See `docs/HANDOFF.md` in the repository for the current state, the remaining work, and the pitfalls found while building it.
