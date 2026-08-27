# `0.1.0-rc.3` prerelease draft

Date: 2026-08-28

Status: **IN REPOSITORY / UNPUBLISHED / PROVIDER-LIVE ACCEPTANCE STILL OPEN**

Compatibility target:

- DeepSeek Harness `0.1.1-rc.2`
- Node.js `24.x` (acceptance uses `24.19.0`)
- pnpm `11.21.0` for development/release gates
- Linux/CachyOS acceptance environment
- Windows: **NOT TESTED**

This document is the current rc.3 release draft. `docs/release/prerelease.md` is the historical published rc.1 record; `docs/release/2026-08-27-rc2-prerelease.md` is the historical parked/unpublished rc.2 record.

## Release family

`0.1.0-rc.3` contains six packages:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

All six move together at exactly the same rc.3 version.

## Main architecture change

The release changes the Suite from several shared/provider-specific helper packages into one provider-independent core plus one plugin per provider.

`nishi-dsh-core` now owns:

- provider registry;
- shared provider registration/rollback;
- shared vendor CLI runtime helpers;
- routed `web_search` tool;
- normalized usage/limits domain;
- host RPC;
- browser Usage & Limits / Model Accounts surfaces.

Providers own only their declared capabilities and protocol translation.

Project Memory remains a separate provider-agnostic package.

## Breaking changes from published rc.1

### Vendor-specific delegation tools removed

The Suite no longer ships vendor-specific child-agent tools for Codex, Antigravity or Claude Code.

Retired surfaces include:

```text
subagent_codex
subagent_antigravity
subagent_claude_code
```

The Orchestrator preset delegates through DSH-native `subagent` / `subagent_fork` on the current primary route instead.

### Package family consolidated

Published rc.1 packages that no longer exist as rc.3 runtime boundaries include:

- `nishi-dsh-claude-code`
- `nishi-dsh-usage-limits`
- `nishi-dsh-codex-usage-source`
- `nishi-dsh-primary-web-search`
- `nishi-dsh-usage-limits-host`

The intermediate in-repo `nishi-dsh-provider-kit` boundary is also gone.

Their responsibilities now live in:

- `nishi-dsh-core` for provider-independent registration/runtime/search/usage/UI;
- `nishi-dsh-codex` for Codex usage source/normalization alongside the Codex adapter;
- `nishi-dsh-claude` for Claude usage-only integration.

Do not deprecate npm names until publication/deprecation is explicitly approved.

### Provider configuration cleanup

Delegated-only provider config was removed with delegation.

Notable removals include:

- Codex delegated-only `providerName` / `permissionMode` configuration;
- Antigravity `subagentProviderName`, `subagentModel`, `subagentEffort`;
- provider-specific Antigravity process knobs previously configured on the generic web-search tool; vendor knobs now live on the Antigravity plugin, with `searchTimeoutMs` owned there.

The preserved model-route strings remain:

```text
codex-app-server
antigravity-cli
```

### Project Memory service boundary changed

The old `ctx.projectMemory` service existed for a delegated read-only memory transport. That service is removed.

Project Memory is now exposed through ordinary DSH tools/context:

```text
memory_read
memory_write
memory_edit
```

plus maintenance commands:

```text
/memory <provider>/<model>
/consolidate <provider>/<model>
```

## Provider changes

### Codex

- canonical provider id: `codex`;
- route stays `codex-app-server`;
- primary App Server + primary history remain;
- native search backend is descriptor-owned while the core owns the model-facing tool;
- rate-limit source lives in the Codex provider package;
- vendor-specific delegation removed;
- vendor-native memory and project-document injection are disabled on the primary invocation with:

  ```text
  memories.use_memories=false
  memories.generate_memories=false
  project_doc_max_bytes=0
  ```

### Antigravity

- canonical provider id: `antigravity`;
- route stays `antigravity-cli`;
- official `agy` primary adapter remains;
- native `agy search_web` backend is descriptor-owned;
- local usage visibility is provider-owned;
- vendor-specific delegation removed.

The hardcoded model-family catalog filter is still scheduled for removal before rc.3 is considered provider-complete.

### Claude

Claude becomes `nishi-dsh-claude`, a usage-only provider:

- canonical id `claude`;
- no model capability;
- no model route;
- no web-search backend;
- usage read through the user's installed official Claude CLI.

## Core accepted state

Core is **DONE / FROZEN** after `docs/verification/gemini/core-14-final-acceptance.md`.

Accepted evidence includes:

- full package/workspace gates;
- six rc.3 tarballs;
- disposable Suite install/reinstall closure;
- installed imports for `nishi-dsh-core`, `/runtime`, `/usage`, `/web-search`, `/client`;
- real DSH host boot + HTTP readiness;
- real agent-plane `nishi-dsh-core/web-search` mount;
- provider-neutral synthetic fourth-provider proof;
- unload/remount without duplicate registry/usage/RPC state.

The real boot gate found and fixed a Cordis lifecycle bug that all unit tests had missed. Final lifecycle:

```text
outer nishi-core (inject: [])
  -> NishiProvidersService
  -> nishi-core-host (inject: nishiProviders, connection, credentials)
```

The core no longer imports/injects `@deepseek-ai/dsh-authorization`; the Suite keeps the official authorization row only as a surrounding-profile compatibility seam.

## Project Memory accepted state

Project Memory is **DONE / FROZEN** after PM01 + PM02 acceptance.

Accepted evidence includes:

- context/tools use one Git-root discovery policy;
- nested cwd cannot split memory into a second `.dsh/memory` tree;
- worktree-style `.git` file support;
- non-Git fallback to explicit absolute cwd;
- `@deepseek-ai/dsh-atomic-write` replacement path;
- symlink/junction refusal and external-target preservation;
- maintenance commands correctly inject `commands + llm` in Cordis;
- disposable installed Suite + real DSH boot PASS.

Project-memory policy explicitly rejects secrets, quota snapshots, raw chain-of-thought, transient logs and operator-personal facts from repository-shared memory.

## Gates already demonstrated during stabilization

At accepted Core/Memory checkpoints:

- `pnpm verify:local`: PASS;
- six rc.3 tarballs packed;
- `pnpm smoke:vendor-cli`: PASS against the installed vendor CLIs recorded by the acceptance reports;
- disposable Suite bundle-install lifecycle: PASS;
- real DSH host boot: PASS.

These are stabilization evidence, not a substitute for the final provider-level/live release run after the remaining provider changes.

## Still required before rc.3 can be called release-ready

### Provider-specific cleanup

- [ ] Codex remaining provider-local failure/helper migration.
- [ ] Antigravity remaining provider-local failure/helper migration.
- [ ] Antigravity model catalog family-filter removal + tests.
- [ ] Claude provider-level cleanup as applicable.

### Live provider/product acceptance

- [ ] Codex primary turn.
- [ ] Codex routed search.
- [ ] Live primary vendor-memory/project-doc suppression proof.
- [ ] Antigravity primary turn.
- [ ] Antigravity mid-conversation model switch.
- [ ] Antigravity routed search.
- [ ] Codex → Antigravity provider switch inside one session.
- [ ] Project memory continuity across that provider switch.
- [ ] Live dynamic Usage & Limits roster: all providers / absent provider / late mount.

### Install/profile acceptance

- [ ] Final target-profile upgrade/reconciliation from local rc.3 tarballs.
- [ ] Preserve existing `dsh-chatgpt-web` link.
- [ ] Managed Orchestrator preset install/status/update/remove.
- [ ] Normal Suite removal/preservation.

### Final release commands

Run after the last provider changes:

```bash
pnpm install --frozen-lockfile
pnpm verify:local
pnpm smoke:vendor-cli
pnpm verify:bundle-install
pnpm check:npm-names
```

Read each command's actual exit code.

## Security/runtime boundary

The release must continue to satisfy:

- no vendor credential/session/token store copied, parsed, migrated or deleted;
- no `@openai/codex*` or `@anthropic-ai/*` package in the Suite runtime lock graph;
- vendor sign-in remains inside official vendor products;
- no silent provider fallback for routed search;
- Project Memory path/symlink confinement remains fail-closed.

## Publication status

**No publication approval has been given for rc.3.**

Do not publish, merge the rc.3 feature branch, create a release/tag, or deprecate npm packages solely because this draft exists.

When every remaining gate is complete, update this file with the final provider/live evidence and request explicit release approval.
