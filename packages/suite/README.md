# Nishi DSH Suite

`nishi-dsh-suite` is the single Market-facing bundle for the modular Nishi integrations for DeepSeek Harness.

The current Suite family is `0.1.0-rc.3`, Node.js 24, and remains unpublished while provider-level acceptance is completed.

## Compatibility status

The only supported DeepSeek Harness generation is `0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`). `0.1.1-rc.2` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence.

The dependency graph implements that policy: the Suite carries `@deepseek-ai/dsh-authorization@0.1.2-alpha.1`, and the Codex, Antigravity and Claude manifests declare their provider-specific peers at the same version. Each provider moved on its own evidence rather than by inheriting the Foundation's.

The provider-independent Foundation packages are broader:

```text
nishi-dsh-core:           0.1.2-alpha.1
nishi-dsh-project-memory: 0.1.2-alpha.1
```

Their alpha.1 support was independently validated against official `dsh-v0.1.2-alpha.1` at exact commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`. That evidence does **not** make the complete Suite/provider graph alpha.1-compatible; each provider owns its own compatibility gate.

## Installed rc.3 family

The bundle installs five Nishi leaf packages at the same rc.3 version:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- `nishi-dsh-codex` — `codex` provider, `codex-app-server` primary route, native search and rate-limits source;
- `nishi-dsh-antigravity` — `antigravity` provider, `antigravity-cli` primary route, native search and local usage visibility;
- `nishi-dsh-claude` — usage-only provider through the installed official Claude CLI;
- `nishi-dsh-project-memory` — root-aware project memory, context injection, memory tools and maintenance commands.

Together with this bundle package, the release family contains six packages.

Provider packages inject the Core registry and call the shared registration path. A provider may declare model, web-search and/or usage capabilities; capability absence is legal. A new provider should require no Core, Project Memory or browser identity edit, but it does require normal declarative Suite packaging metadata.

## Host-plane composition

`cordis.patch.yml` currently inserts:

- the official `@deepseek-ai/dsh-authorization` compatibility row;
- Project Memory;
- Codex, Antigravity and Claude provider plugins;
- `nishi-dsh-core`.

Provider rows may appear before the Core row because they inject `nishiProviders`; Cordis defers them until the registry exists.

The Core host lifecycle is registry-first:

1. outer `nishi-core` publishes `NishiProvidersService`;
2. internal `nishi-core-host` waits for `nishiProviders`, `connection` and `credentials`;
3. provider plugins become eligible when their own dependencies plus `nishiProviders` are present.

The Core itself no longer imports or injects the authorization service. Its Model Accounts host reads the DSH credentials service directly, and destructive legacy-grant logout is disabled unless a future credential contract offers an atomic-safe removal operation.

## Agent-plane Orchestrator preset

The routed search tool is not a host bundle row. The packaged Orchestrator preset mounts:

```text
nishi-dsh-core/web-search
```

on the agent plane, along with shared Project Memory tools and DSH-native `subagent` / `subagent_fork` delegation.

Vendor-specific delegation tools were removed in rc.3. Delegated DSH child agents follow the active primary route instead of creating separate vendor-specific tool/memory environments.

## Managed preset bridge

DSH `0.1.1-rc.2` supported `$DSH_HOME/.agent-presets`, but its launcher did not reliably preserve third-party contributed preset roots, which is why this managed bridge exists. **Whether `0.1.2-alpha.1` still has that limitation has not been checked** — if it does not, this bridge is obsolete and should be removed rather than carried forward. Until someone verifies that, use the installed Suite command:

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

Core and Project Memory were accepted and frozen at the implementation below, but a follow-up audit has since changed both, along with Codex. They are **THAWED, pending re-validation**; the evidence below is history and does not describe this tree.

Superseded accepted Foundation implementation:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw independent follow-up PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Foundation evidence includes Core `182/182`, Project Memory `64/64`, full workspace test/check/build, `pnpm verify:local`, repeated Project Memory concurrency/recovery suites, zero unexpected lock/WAL residue, bidirectional atomic-write lock interoperability, and disposable exact-commit alpha.1 runtime probes.

Provider packages are **not yet frozen** for the current rc.3 provider stage. Codex is active; Antigravity and Claude follow. Historical provider tests, CLI smoke runs, disposable bundle installs and earlier live fixtures remain useful checkpoint evidence, but they must not be presented as final acceptance for a later changed provider tree.

The final Suite/product gate still requires fresh provider freezes, repository-wide invariants, cross-provider live acceptance, install/profile lifecycle acceptance and the release commands defined in `docs/RELEASE.md`.

See `docs/HANDOFF.md` for the immediate task, `docs/ROADMAP.md` for task order, and `docs/verification/README.md` for exact accepted checkpoint evidence.

Windows remains **NOT TESTED** for rc.3.