# Nishi DSH Suite

`nishi-dsh-suite` is the single Market-facing bundle for the modular Nishi integrations for DeepSeek Harness.

Compatibility target: **DeepSeek Harness 0.1.1-rc.2**, Node.js 24. The current Suite family is **`0.1.0-rc.3`** and remains unpublished while provider-level acceptance is completed.

## Installed rc.3 family

The bundle installs five Nishi leaf packages at the same rc.3 version:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- `nishi-dsh-codex` — `codex` provider, `codex-app-server` primary route, native search and rate-limits source;
- `nishi-dsh-antigravity` — `antigravity` provider, `antigravity-cli` primary route, native search and local usage visibility;
- `nishi-dsh-claude` — usage-only provider through the installed official Claude CLI;
- `nishi-dsh-project-memory` — root-aware project memory, context injection, memory tools and maintenance commands.

Together with this bundle package, the release family contains six packages.

Provider packages inject the core registry and call the shared registration path. A provider may declare model, web-search and/or usage capabilities; capability absence is legal. A new provider should require no core, project-memory or browser edit, but it does require the normal declarative Suite packaging change: dependency/bundle row plus release-family metadata.

## Host-plane composition

`cordis.patch.yml` currently inserts:

- the official `@deepseek-ai/dsh-authorization` compatibility row;
- Project Memory;
- Codex, Antigravity and Claude provider plugins;
- `nishi-dsh-core`.

Provider rows may appear before the core row because they declare `inject: ['nishiProviders', ...]`; Cordis defers them until the registry exists.

The core's final host lifecycle is registry-first:

1. outer `nishi-core` has no external injections and publishes `NishiProvidersService`;
2. internal `nishi-core-host` waits for `nishiProviders`, `connection` and `credentials`;
3. provider plugins become eligible when their own dependencies plus `nishiProviders` are present.

The Suite still carries `@deepseek-ai/dsh-authorization@0.1.1-rc.2` as a surrounding-profile compatibility seam. **The core itself no longer imports or injects the authorization service.** Its Model Accounts host reads the DSH credentials service directly.

## Agent-plane Orchestrator preset

The routed search tool is not a host bundle row. The packaged Orchestrator preset mounts:

```text
nishi-dsh-core/web-search
```

on the agent plane, along with shared project-memory tools and DSH-native `subagent` / `subagent_fork` delegation.

Vendor-specific delegation tools were removed in rc.3. Delegated DSH child agents now follow the primary route instead of creating separate vendor-specific tool/memory environments.

## Managed preset bridge

DSH `0.1.1-rc.2` supports `$DSH_HOME/.agent-presets`, but its launcher overwrites third-party contributed preset roots. Until that upstream limitation changes, use the installed Suite command:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

After an update:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset update
```

Before Suite removal:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset remove
dsh plugin --profile web remove nishi-dsh-suite
```

The bridge manages only `$DSH_HOME/.agent-presets/orchestrator` plus transient stage/backup siblings during atomic replacement. Ownership metadata and SHA-256 hashes prevent overwriting or deleting an unmanaged/locally edited preset directory.

The executable is run through `dsh plugin --profile <profile> exec`, so it comes from the exact Suite version installed in that DSH profile.

## Authentication and vendor runtime boundary

The Suite does not install vendor CLIs and does not copy, parse, migrate or replay vendor credential stores.

- Codex uses the installed official `codex` CLI/App Server boundary.
- Antigravity uses the installed official `agy` boundary.
- Claude usage uses the installed official `claude` CLI.

The installed Suite dependency closure must remain free of `@openai/codex*` and `@anthropic-ai/*` runtime packages.

## Current verification status

Core and Project Memory are **DONE / FROZEN** after separate final acceptance passes.

The rc.3 family has already passed:

- `pnpm verify:local` with six tarballs;
- provider protocol smoke against installed Codex/Antigravity/Claude CLIs;
- disposable Suite bundle install/reinstall closure;
- installed `nishi-dsh-core` subpath resolution including `/web-search`;
- real disposable DSH host boot and HTTP readiness;
- agent-plane `nishi-dsh-core/web-search` mount;
- Project Memory root-consistency, atomic-write and maintenance-command Cordis probes.

Still required before claiming rc.3 product-level completion:

- provider-specific cleanup that remains in Codex/Antigravity/Claude;
- Antigravity model-catalog honesty/tests;
- live Codex primary/search/vendor-memory suppression acceptance;
- live Antigravity primary/model-switch/search acceptance;
- Codex → Antigravity route switch in one session with project-memory continuity;
- live Usage & Limits dynamic-roster/browser cases;
- network/release gates and an explicitly approved publish decision.

See `docs/HANDOFF.md`, `docs/ROADMAP.md`, and `docs/RELEASE.md` for current status.

Windows remains **NOT TESTED** for rc.3.
