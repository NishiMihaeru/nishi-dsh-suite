# Nishi DSH Suite

`nishi-dsh-suite` is the single Market-facing bundle for the modular Nishi integrations for DeepSeek Harness.

Compatibility target: **DeepSeek Harness 0.1.1-rc.2**, Node.js 24, pnpm 11.21.0 for development.

## Runtime modules

Installing this bundle brings the exact `0.1.0-rc.1` prerelease family:

- `nishi-dsh-codex` — Codex primary/subagent integration (with `codex-app-server` provider via pinned `codex-plugin-dsh`);
- `nishi-dsh-antigravity` — Antigravity primary/subagent integration through `agy`;
- `nishi-dsh-claude-code` — Claude Code subagent through the official Agent SDK;
- `nishi-dsh-primary-web-search` — the single `web_search` tool routed by the active primary provider;
- `nishi-dsh-project-memory` — project-scoped DSH memory and memory tools;
- `nishi-dsh-usage-limits` — normalized usage/limits domain library;
- `nishi-dsh-usage-limits-host` — host/RPC/browser Usage & Limits integration;
- `nishi-dsh-codex-usage-source` — official Codex app-server rate-limit source adapter.

The Suite also installs the official `@deepseek-ai/dsh-authorization@0.1.1-rc.2` service because Usage Limits Host injects `authorization` and stock rc.2 base/web profiles do not mount that service themselves.

`cordis.patch.yml` mounts host-plane plugins: the official authorization seam, Project Memory, the three managed provider packages, and Usage Limits Host. `nishi-dsh-primary-web-search` remains an installed dependency but is mounted on the **agent plane** by the Orchestrator preset, matching DSH Web's rc.2 ownership model. The usage domain and Codex usage source are library dependencies and are not Cordis rows.

## Authentication boundary

The authorization service is only the DSH service seam required by the Model Accounts/legacy-grant status surface. The Suite does not install vendor clients and does not copy vendor OAuth/session/token databases. Codex, Claude Code, and Antigravity continue to use their vendor-owned local runtimes and authentication state.

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

This package is a prerelease migration target. Static composition and the managed preset bridge are present in the public repository; executable install/check/test/build/preset acceptance still requires a regenerated workspace lockfile and an available local/hosted runner.
