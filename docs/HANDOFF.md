# `0.1.0-rc.3` handoff

Updated 2026-08-28 after Core and Project Memory final acceptance.

This is the canonical short handoff for the next session. Historical implementation detail remains in git history and the dated verification reports; do not reconstruct current state from older unchecked roadmap items.

## Goal

Provider switching should be a route change, not an environment change: the same DSH tools, project memory, Usage & Limits surface, profile and session context remain available while only provider protocol translation changes.

## Current branch and release state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

`0.1.0-rc.3` is **in-repo and unpublished**. `0.1.0-rc.1` remains the published npm family; rc.2 was deliberately parked unpublished.

No publish, merge, release or tag is authorized by this handoff.

## Frozen packages

### Core — DONE / FROZEN

Core stabilization finished with `docs/verification/gemini/core-14-final-acceptance.md` = PASS.

The accepted contract includes:

- provider-independent registry and `registerProvider()` transaction;
- canonical provider ids/routes;
- transactional rollback;
- late provider registration/withdrawal;
- provider-without-usage support;
- stale browser async protection;
- shared `VendorFailure` contract;
- no direct core dependency on `dsh-subagent` or `dsh-authorization`;
- provider-neutral core boundary with a synthetic fourth-provider proof;
- canonical Web Search request-header routing and error taxonomy;
- final registry-first Cordis lifecycle:
  - outer `nishi-core`: `inject: []`;
  - publishes `NishiProvidersService`;
  - mounts `nishi-core-host` with `['nishiProviders', 'connection', 'credentials']`.

Final Core acceptance proved:

- full local workspace gate;
- six rc.3 tarballs;
- disposable Suite installation;
- installed core subpath imports including `/web-search`;
- real DSH host boot + HTTP readiness;
- real agent-plane `nishi-dsh-core/web-search` mount;
- unload/remount without duplicate registry/RPC services.

Do not change `packages/core` unless a new reproducible blocker requires reopening the frozen package.

### Project Memory — DONE / FROZEN

Project Memory finished with:

- `docs/verification/gemini/project-memory-01-root-consistency.md` = PASS;
- `docs/verification/gemini/project-memory-02-final-acceptance.md` = PASS.

Accepted behavior:

- context injection and memory tools use one `findProjectRoot()` policy;
- nested cwd resolves to nearest `.git` root;
- worktree-style `.git` files work;
- non-Git fallback is normalized explicit cwd;
- no nested split-brain `.dsh/memory` tree;
- replacement writes use `@deepseek-ai/dsh-atomic-write` after canonical path/symlink checks;
- `/memory` and `/consolidate` register through `ctx.inject(['commands', 'llm'], ...)`;
- memory policy rejects secrets, quota snapshots, chain-of-thought, transient logs and operator-personal facts;
- disposable Suite install and real DSH boot pass with the atomic-write peer dependency.

Do not change `packages/project-memory` unless a new reproducible blocker requires reopening it.

## Current architecture

Canonical spec:

```text
docs/superpowers/specs/provider-bridge-design.md
```

Providers are Cordis plugins that inject `nishiProviders` and call the shared `registerProvider()` path.

Actual descriptor shape:

- `id`
- `presentation`
- `executable`
- optional `model` with `model.routes`
- optional `webSearch`
- optional `usage`
- optional `install`

A new provider must not require edits to core, Project Memory, generic usage/search composition or browser identity logic. Shipping it still requires declarative Suite packaging: dependency/bundle row and release-family metadata.

Canonical ids/routes:

- `codex` → `codex-app-server`
- `antigravity` → `antigravity-cli`
- `claude` → no model route, usage-only

Vendor-specific subagent integrations are gone. Orchestrator delegation is DSH-native `subagent` / `subagent_fork` on the current primary route.

## Remaining rc.3 work

Continue in this order.

### 1. Codex provider

Scope only `packages/codex` plus provider-level tests/docs when required.

Remaining:

- migrate remaining provider-local failure classes/string builders to the core `VendorFailure` contract;
- deduplicate remaining provider-local generic helpers when a core helper already owns the contract;
- run focused tests/check/build;
- live acceptance: primary turn, routed `web_search`, vendor-memory/project-doc suppression on the primary invocation.

Freeze Codex after its final provider acceptance.

### 2. Antigravity provider

Remaining:

- migrate remaining provider-local failure helpers to core contracts;
- remove hardcoded model-family catalog filtering while retaining malformed-entry rejection;
- add catalog parser/model-list coverage;
- run focused tests/check/build;
- live acceptance: primary turn, model switch in one session, routed `web_search`.

Freeze Antigravity after its final provider acceptance.

### 3. Claude provider

Claude stays usage-only.

Remaining:

- provider-local failure/helper cleanup as applicable;
- focused tests/check/build and usage-source smoke;
- release acceptance only; no Claude primary route is planned for rc.3.

Freeze Claude after its provider acceptance.

### 4. Repository-wide/provider invariants

Core-specific fourth-provider extension was already proved with an unfamiliar synthetic provider (`nebula`). Do not redo that as core work.

Before final rc.3 acceptance, finish/confirm repository-wide guards that:

- provider packages do not directly register LLM adapters outside `registerProvider()`;
- no vendor subagent registration/tool returns;
- core remains independent of provider packages;
- a model capability always has at least one canonical route;
- provider absence/capability absence remain supported.

A shipping fourth provider may require a Suite dependency/bundle row. That is expected declarative packaging and is not a failure of core neutrality.

### 5. Product-level live acceptance

One deliberate quota-spending run should cover:

- Codex primary + routed search + memory;
- Antigravity primary + model switch + routed search;
- **Codex → Antigravity route switch inside one session**;
- project memory written before the switch and read after it;
- Usage & Limits with all providers;
- profile without Antigravity;
- provider appearing after the browser surface is already active;
- fresh/local-tarball Suite install/upgrade lifecycle preserving the existing `dsh-chatgpt-web` link;
- managed preset install/status/update/remove;
- normal Suite removal.

### 6. Release gates

Before any publish proposal:

```bash
pnpm install --frozen-lockfile
pnpm verify:local
pnpm smoke:vendor-cli
pnpm verify:bundle-install
pnpm check:npm-names
```

Read exit codes directly; do not hide them through pipes.

Then finish `docs/release/2026-08-28-rc3-prerelease.md` with the live-provider results.

Publishing still requires separate explicit maintainer approval.

## Working workflow used in this stabilization session

This workflow is deliberate because the assistant can edit GitHub but cannot run the maintainer's local DSH/vendor environment.

1. Assistant fetches the current GitHub file and blob SHA from `feat/core-provider-plugins-rc3`.
2. Assistant makes one narrow source/test/documentation change directly on the branch.
3. Assistant supplies a complete Gemini validation prompt.
4. Gemini runs locally with exact Node 24.19.0 path:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini does not fix implementation unless a prompt explicitly allows one deterministic generated file such as `pnpm-lock.yaml`.
6. Gemini writes one designated Markdown report under `docs/verification/gemini/`, commits allowed files and pushes the same branch even on FAIL.
7. Maintainer replies only `готово`.
8. Assistant reads the report directly from GitHub, validates tested SHA / Node / commands / review and either:
   - patches the blocker and issues a rerun prompt; or
   - explicitly closes the issue and moves on.
9. No GitHub Actions/CI are used.

This workflow caught blockers unit tests alone missed, most importantly the real Core Cordis boot failure caused by accessing `ctx.nishiProviders` without injection.

## Environment / hard constraints

- Node: `v24.19.0` through fnm.
- pnpm: `11.21.0`.
- DSH: `0.1.1-rc.2`.
- `/usr/bin/node` may be v22; do not use it for acceptance.
- GitHub-hosted CI/Actions are prohibited for this work and no hosted-CI PASS may be claimed.
- Do not inspect or edit `.github/workflows/*`.
- Do not copy/parse/migrate/delete vendor credential/session/token stores.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the Suite runtime lock graph.
- Windows remains **NOT TESTED**.
- No publish / merge / tag / release without explicit approval.

## Useful traps already learned

- Cordis service access is injection-protected. `as any` does not bypass the runtime proxy.
- A service reached through the Cordis proxy cannot safely use unbound methods that rely on `#private` fields; the core services bind public methods in their constructors.
- Provider registrations arrive after the core publishes `nishiProviders`; any roster must be dynamic.
- Provider package checks can see stale built core declarations after a core type edit; rebuild core first if core is ever intentionally reopened.
- DSH `0.1.1-rc.2` overwrites contributed preset roots, so the Suite's managed preset bridge remains required.
- Vendor CLI drift is only caught by `pnpm smoke:vendor-cli` / live provider tests, not ordinary unit tests.
- Live provider tests consume real subscription quota. Group them deliberately.

## Canonical current docs

Read these in order:

1. `docs/HANDOFF.md`
2. `docs/ROADMAP.md`
3. `docs/superpowers/specs/provider-bridge-design.md`
4. `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md`
5. `docs/SESSION-SUMMARY-2026-08-28.md`
6. `docs/release/2026-08-28-rc3-prerelease.md`

Historical rc.1/rc.2 release records and older dated plans/specs intentionally retain period-specific package names and assumptions.
