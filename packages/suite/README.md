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

The Suite also installs the official `@deepseek-ai/dsh-authorization@0.1.1-rc.2` service because Usage Limits Host injects `authorization` and stock rc.2 base/web profiles do not mount that service themselves.

`cordis.patch.yml` mounts host-plane plugins: the official authorization seam, Project Memory, the three managed provider packages, and Usage Limits Host. `nishi-dsh-primary-web-search` remains an installed dependency but is mounted on the **agent plane** by the Orchestrator preset, matching DSH Web's rc.2 ownership model. The usage domain and Codex usage source are library dependencies and are not Cordis rows.

## Authentication boundary

The authorization service is only the DSH service seam required by the Model Accounts/legacy-grant status surface. The Suite does not install vendor clients and does not copy vendor OAuth/session/token databases. Codex, Claude Code, and Antigravity continue to use their vendor-owned local runtimes and authentication state.

## Orchestrator preset on DSH 0.1.1-rc.2

The npm package contains the accepted Orchestrator preset under `presets/orchestrator`. Both `preset.yml` and `agent.cordis.yml` are included in the package artifact.

DSH rc.2 does not expose a bundle seam that lets a third-party package add its own preset root automatically. DSH does, however, always include the user preset root at `$DSH_HOME/.agent-presets` (default `~/.dsh/.agent-presets`). Until the upstream discovery seam is fixed, Suite provides an explicit managed bridge that copies only its packaged Orchestrator into that supported user root.

After installing Nishi DSH Suite into the `web` profile through Market, run:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
```

The `dsh plugin` command forwards to pnpm inside the selected DSH profile, so this executes the exact Suite version installed by Market rather than downloading another copy.

Lifecycle commands:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset update
dsh plugin --profile web exec nishi-dsh-suite preset remove
```

Run `preset update` after a Suite update. Run `preset remove` **before uninstalling the Suite from Market**, because DSH rc.2 provides no bundle uninstall hook that can safely remove a user-authored preset directory after the package has gone away.

The bridge manages only:

```text
$DSH_HOME/.agent-presets/orchestrator/
```

It writes a small ownership marker with SHA-256 file hashes. It refuses to overwrite an unmanaged `orchestrator` directory and refuses to update or remove a managed preset after local edits. Other presets, DSH profiles, sessions, project files, Project Memory, credentials, and vendor-owned state are outside its write boundary.

Automatic one-click preset discovery remains tracked as upstream issue #2. Once DSH exposes a stable third-party preset-root seam, this explicit bridge can be retired without changing the provider packages.

## Development status

This package is a prerelease migration target. Static composition and the managed preset bridge are present in the public repository; executable install/check/test/build acceptance still requires a regenerated workspace lockfile and an available runner/local environment.
