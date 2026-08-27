# Core and Provider Plugins Execution Plan (`0.1.0-rc.3`)

Updated 2026-08-28. This file is now the **canonical remaining execution plan** for rc.3.

The original detailed Tasks 0–12, intermediate assumptions and implementation notes are preserved in git history. They are no longer repeated here because Core and Project Memory have completed final acceptance and their old unchecked items were misleading.

## Goal

Working across subscription providers should be a route change and nothing else: same DSH tools, project memory, Usage & Limits surface, profile and session context.

Canonical architecture: `docs/superpowers/specs/provider-bridge-design.md`.

Canonical handoff: `docs/HANDOFF.md`.

Roadmap: `docs/ROADMAP.md`.

## Global constraints

- Family stays exactly `0.1.0-rc.3` until an intentional version change.
- No publish, merge, tag or release without explicit maintainer approval.
- No vendor credential/session/token store is copied, parsed, migrated or deleted.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the Suite runtime lock graph.
- Route strings `codex-app-server` and `antigravity-cli` remain stable.
- Windows remains **NOT TESTED**.
- GitHub Actions/hosted CI are not used for this work.
- Node acceptance uses `v24.19.0` through fnm and pnpm `11.21.0`.

---

## Completed architecture

### Delegation removal — DONE

- [x] Codex vendor subagent runner/wire/memory transport removed.
- [x] Antigravity vendor subagent/memory transport removed.
- [x] Project Memory subagent-only service/surface removed.
- [x] Vendor-specific preset delegation tools removed.
- [x] Orchestrator uses DSH-native `subagent` / `subagent_fork` on the primary route.
- [x] Codex vendor-memory/project-doc suppression moved to the primary App Server invocation before deleting the delegated path.

### Core package/connector — DONE / FROZEN

- [x] Former provider-kit, usage-limits, usage-limits-host and primary-web-search boundaries folded into `nishi-dsh-core`.
- [x] `NishiProvidersService` registry.
- [x] Shared `registerProvider()` transaction with rollback.
- [x] Canonical provider id/route validation.
- [x] Model routes live on `descriptor.model.routes`.
- [x] Provider-owned optional web-search capability.
- [x] Provider-owned optional usage capability.
- [x] Serialized `ProviderPresentation` for browser identity.
- [x] Dynamic registry-driven roster.
- [x] Claude usage-only provider proves capability absence.
- [x] Core has no provider-package dependency.
- [x] Synthetic fourth-provider (`nebula`) extension proof.
- [x] Canonical Web Search request-header validation and no-fallback taxonomy.
- [x] Final registry-first host lifecycle accepted in a real DSH boot.
- [x] Installed `nishi-dsh-core/web-search` subpath mount accepted in a real DSH profile.

Verification record: `docs/verification/gemini/core-14-final-acceptance.md`.

**Do not edit `packages/core` for cleanup. Reopen only for a new reproducible blocker.**

### Project Memory — DONE / FROZEN

- [x] Provider-independent tools/context.
- [x] Operator-personal facts excluded from repository-shared memory policy.
- [x] Context and tools share nearest-Git-root discovery.
- [x] Nested-cwd split memory fixed.
- [x] Worktree `.git` file and non-Git fallback accepted.
- [x] Shared `@deepseek-ai/dsh-atomic-write` replacement path.
- [x] Symlink/junction target refusal preserved.
- [x] `/memory` and `/consolidate` inject `commands + llm` correctly through Cordis.
- [x] Disposable installed-profile and real DSH boot acceptance.

Verification records:

- `docs/verification/gemini/project-memory-01-root-consistency.md`
- `docs/verification/gemini/project-memory-02-final-acceptance.md`

**Do not edit `packages/project-memory` for cleanup. Reopen only for a new reproducible blocker.**

---

## Task 1 — Finish Codex provider

Scope: `packages/codex` and directly related provider tests/docs only.

### 1.1 Shared failure contract

- [ ] Inventory Codex-local error/failure classes and string builders.
- [ ] Replace cases that represent vendor process/protocol failures with core `VendorFailure` metadata.
- [ ] Preserve provider-specific recognition/parsing in Codex.
- [ ] Do not forward raw vendor stderr into user-facing messages.

### 1.2 Generic helper cleanup

- [ ] Inventory remaining `record`, `thrown`, `bounded` or equivalent generic helpers.
- [ ] Reuse core helpers only where semantics are genuinely the same.
- [ ] Do not force provider protocol translation into generic core abstractions.

### 1.3 Static/local gate

- [ ] `pnpm --filter nishi-dsh-codex test` exit 0.
- [ ] `pnpm --filter nishi-dsh-codex check` exit 0.
- [ ] `pnpm --filter nishi-dsh-codex build` exit 0.
- [ ] `pnpm smoke:vendor-cli` Codex portion PASS after source/normalizer changes.

### 1.4 Codex final live acceptance

One deliberate quota-spending run:

- [ ] primary turn completes;
- [ ] routed native `web_search` completes;
- [ ] project memory tools available on the primary route;
- [ ] vendor-native memory and project-doc content do not reach the turn because the three primary invocation overrides are active;
- [ ] route remains `codex-app-server`.

Then freeze Codex.

---

## Task 2 — Finish Antigravity provider

Scope: `packages/antigravity` and directly related provider tests/docs only.

### 2.1 Shared failure contract

- [ ] Migrate provider-local process/search/usage failure builders that belong to the core `VendorFailure` contract.
- [ ] Keep Antigravity-specific parsing/recognition provider-owned.

### 2.2 Honest model catalog

- [ ] Remove the hardcoded accepted-family filter from model catalog discovery.
- [ ] Remove the equivalent family restriction from line-scanning fallback parsing.
- [ ] Keep malformed-entry rejection.
- [ ] Add unit tests for catalog parsing/model-list discovery.
- [ ] Prove unknown-but-well-formed family names are not silently hidden.

### 2.3 Static/local gate

- [ ] `pnpm --filter nishi-dsh-antigravity test` exit 0.
- [ ] `pnpm --filter nishi-dsh-antigravity check` exit 0.
- [ ] `pnpm --filter nishi-dsh-antigravity build` exit 0.
- [ ] `pnpm smoke:vendor-cli` Antigravity portion PASS.

### 2.4 Antigravity final live acceptance

- [ ] primary turn completes;
- [ ] model switch in the same conversation completes without losing history/tools/memory;
- [ ] routed `agy search_web` completes;
- [ ] route remains `antigravity-cli`;
- [ ] no deprecated vendor subagent path is involved.

Then freeze Antigravity.

---

## Task 3 — Finish Claude provider

Claude stays **usage-only** in rc.3.

### 3.1 Provider cleanup

- [ ] Inventory Claude-local error/failure helpers.
- [ ] Reuse core failure/runtime contracts where semantics match.
- [ ] Keep official Claude CLI usage protocol provider-owned.

### 3.2 Contract/gates

- [ ] Descriptor still has usage only: no model, no routes, no webSearch.
- [ ] `pnpm --filter nishi-dsh-claude test` exit 0.
- [ ] `pnpm --filter nishi-dsh-claude check` exit 0.
- [ ] `pnpm --filter nishi-dsh-claude build` exit 0.
- [ ] Claude portion of `pnpm smoke:vendor-cli` PASS.

Then freeze Claude.

---

## Task 4 — Final repository invariants

Core10 already proves the core extension seam. This task is the repository-wide guard layer, not another core redesign.

- [ ] Provider packages do not call `ctx.llm.registerAdapter` directly outside the shared registration module.
- [ ] No provider registers a vendor subagent provider.
- [ ] No retired `subagent_codex`, `subagent_antigravity`, `subagent_claude_code` tool row exists.
- [ ] Core depends on no provider package.
- [ ] Every provider with `model` exposes at least one canonical route.
- [ ] Every provider without `model` exposes no model route.
- [ ] Usage-only Claude remains a shipping capability-absence proof.
- [ ] Synthetic fourth-provider extension proof remains green.
- [ ] Deliberately break new invariant tests once while developing them to prove they can fail.

A shipping provider requiring a `packages/suite` dependency/bundle row is expected. Do not encode the false invariant that Suite composition never changes when a new package ships.

---

## Task 5 — Product-level cross-provider acceptance

This is the key product proof.

### 5.1 Same-session route switching

- [ ] Start one conversation on Codex.
- [ ] Write/read project memory.
- [ ] Switch primary route Codex → Antigravity without creating a new harness/session environment.
- [ ] Read the memory written before the switch.
- [ ] Confirm common tools remain available.
- [ ] Confirm history/context survives.

### 5.2 Usage & Limits / browser

- [ ] All configured providers render from the dynamic roster.
- [ ] Profile without Antigravity has no placeholder/blank Antigravity row.
- [ ] Provider mounted after browser initialization appears on a later roster refresh.
- [ ] Provider withdrawal does not leave stale rows.
- [ ] Model Accounts remains read/logout compatibility only; no Nishi-managed vendor OAuth starts.

Record the final live acceptance under `docs/acceptance/`.

---

## Task 6 — Profile/install acceptance

Use disposable/local-tarball profiles first.

- [ ] `pnpm verify:bundle-install` / equivalent disposable install lifecycle PASS.
- [ ] Fresh rc.3 profile boot PASS.
- [ ] Reconciliation/update does not duplicate bundle rows.
- [ ] Preserve the existing `dsh-chatgpt-web` link during the real target-profile upgrade test.
- [ ] `preset install` PASS.
- [ ] `preset status` reports current.
- [ ] `preset update` PASS.
- [ ] `preset remove` PASS.
- [ ] Suite removal leaves unrelated plugins/sessions/project state/vendor auth untouched.

---

## Task 7 — Final rc.3 gates and release note

Run from Node 24.19.0 and read real exit codes:

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm verify:local`
- [ ] `pnpm smoke:vendor-cli`
- [ ] `pnpm verify:bundle-install`
- [ ] `pnpm check:npm-names` (network-dependent)
- [ ] banned vendor runtime closure check remains clean
- [ ] Windows remains explicitly NOT TESTED unless a separate Windows run is performed

Update:

```text
docs/release/2026-08-28-rc3-prerelease.md
```

with final provider/product acceptance evidence.

Stop after the release candidate is documented. Publishing/deprecation/merge/tagging require separate explicit approval.

---

## Breaking changes that the rc.3 release note must retain

- vendor-specific Codex/Antigravity delegation tools removed;
- previously removed Claude Code subagent stays removed;
- Orchestrator delegates through DSH-native child agents on the primary route;
- retired packages `nishi-dsh-provider-kit`, `nishi-dsh-usage-limits`, `nishi-dsh-usage-limits-host`, `nishi-dsh-primary-web-search` are superseded by `nishi-dsh-core`;
- `nishi-dsh-claude` is the new Claude usage-only provider package;
- removed delegated-only provider config fields remain removed;
- `ctx.projectMemory` service no longer exists;
- web-search provider knobs live on provider plugins rather than the generic tool.

---

## Validation workflow for remaining tasks

For every implementation issue:

1. fetch fresh GitHub file + SHA;
2. make one narrow change directly on `feat/core-provider-plugins-rc3`;
3. give Gemini a report-only local validation prompt;
4. Gemini uses Node 24.19.0 and runs package/full gates as requested;
5. Gemini may modify only the designated `docs/verification/gemini/*.md` report unless an explicit deterministic generated-file exception is stated;
6. Gemini commits/pushes report even on FAIL;
7. maintainer replies `готово`;
8. read report from GitHub, patch blocker or close issue;
9. freeze each provider once its final acceptance passes.

No GitHub Actions/hosted CI.
