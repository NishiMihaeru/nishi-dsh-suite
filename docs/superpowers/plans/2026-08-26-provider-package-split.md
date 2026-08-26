# Provider Package Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the transitional combined `nishi-dsh-codex-antigravity` package with independent Codex, Antigravity, and primary-web-search packages while preserving accepted runtime behavior.

**Architecture:** Provider-specific runtime code lives only in its provider package. `nishi-dsh-primary-web-search` owns the single model-facing `web_search` tool and consumes provider-owned backend seams from `nishi-dsh-codex` and `nishi-dsh-antigravity`. `nishi-dsh-claude-code` remains independent.

**Tech Stack:** Node.js 24, TypeScript 5.9.2, pnpm 11.21.0, DSH 0.1.1-rc.2, Codex 0.147.0, Claude Agent SDK 0.3.220.

**Spec:** `docs/superpowers/specs/2026-08-26-provider-package-split-design.md`

## Global Constraints

- Preserve provider IDs: `codex`, `antigravity`, `codex-app-server`, `antigravity-cli`, `claude-code`.
- Preserve accepted runtime behavior before refactoring internals.
- `nishi-dsh-antigravity` must not depend on `@openai/codex` or `@openai/codex-sdk`.
- `nishi-dsh-codex` must not register Antigravity.
- Provider packages must not register the model-facing `web_search` tool.
- `nishi-dsh-primary-web-search` must register exactly one `web_search` tool.
- No DeepSeek/Exa/Perplexity fallback and no `DEEPSEEK_API_KEY` requirement.
- Vendor authentication remains vendor-owned; no credential copying or alternate vendor homes.
- GitHub Actions verification is externally blocked by the account billing lock; do not claim deterministic gates passed until they are actually run.

---

### Task 1: Split Codex package

**Files:**
- Create: `packages/codex/package.json`
- Create: `packages/codex/tsconfig.json`
- Create: `packages/codex/README.md`
- Create: `packages/codex/LICENSE`
- Create: `packages/codex/THIRD_PARTY_NOTICES.md`
- Move/adapt: Codex-owned files from `packages/codex-antigravity/src/`
- Move/adapt: Codex-owned deterministic/live tests.

**Interfaces:**
- Produces package `nishi-dsh-codex@0.1.0-rc.1`.
- Produces exports `.`, `./invariant`, `./web-search-backend`, `./package.json`.
- `./web-search-backend` exports the Codex native web-search backend without registering a DSH tool.

- [ ] Create package metadata with only Codex/OpenAI dependencies.
- [ ] Move `index.ts`, `run.ts`, `wire.ts`, `resolver.ts`, `memory.ts`, `primary-history.ts` and Codex-owned search backend code.
- [ ] Remove Antigravity registration/imports from the Codex plugin root.
- [ ] Adapt invariant ownership to `nishi-dsh-codex`.
- [ ] Move Codex tests and update package-name assertions/imports.
- [ ] Verify structurally that no Antigravity implementation remains in the package.
- [ ] Commit as `refactor: split Codex provider package`.

### Task 2: Split Antigravity package

**Files:**
- Create: `packages/antigravity/package.json`
- Create: `packages/antigravity/tsconfig.json`
- Create: `packages/antigravity/README.md`
- Create: `packages/antigravity/LICENSE`
- Create: `packages/antigravity/THIRD_PARTY_NOTICES.md`
- Move/adapt: `antigravity-primary.ts`, `antigravity-subagent.ts`, Antigravity backend and tests.

**Interfaces:**
- Produces package `nishi-dsh-antigravity@0.1.0-rc.1`.
- Produces exports `.`, `./invariant`, `./web-search-backend`, `./package.json`.
- `./web-search-backend` exports the `agy search_web` backend without registering a DSH tool.

- [ ] Create package metadata with no OpenAI dependencies.
- [ ] Create provider root that registers only Antigravity primary/subagent behavior.
- [ ] Preserve official `agy` process boundary and safe permission/cancellation semantics.
- [ ] Add package invariant ownership for `nishi-dsh-antigravity`.
- [ ] Move Antigravity tests and update package-name assertions/imports.
- [ ] Verify structurally that no `@openai/*` dependency/import remains.
- [ ] Commit as `refactor: split Antigravity provider package`.

### Task 3: Extract primary web search

**Files:**
- Create: `packages/primary-web-search/package.json`
- Create: `packages/primary-web-search/tsconfig.json`
- Create: `packages/primary-web-search/README.md`
- Create/move: route, error, normalization, presentation, tool, provider-dispatch code.
- Create/adapt: routing/presentation/composition tests.

**Interfaces:**
- Produces `nishi-dsh-primary-web-search@0.1.0-rc.1`.
- Consumes `CodexSearchBackend` from `nishi-dsh-codex/web-search-backend`.
- Consumes `AntigravitySearchBackend` from `nishi-dsh-antigravity/web-search-backend`.
- Registers exactly one tool named `web_search`.

- [ ] Move route/errors/types/result/presentation/tool ownership to the new package.
- [ ] Replace local provider backend imports with package subpath imports.
- [ ] Keep dynamic provider routing on each call.
- [ ] Keep unsupported-provider fail-closed behavior.
- [ ] Move web-search deterministic/live tests to the new package.
- [ ] Assert source has no `ctx.web`, `DEEPSEEK_API_KEY`, DeepSeek, Exa, or Perplexity fallback.
- [ ] Commit as `refactor: extract primary web search package`.

### Task 4: Remove transitional combined package

**Files:**
- Delete: `packages/codex-antigravity/**`.
- Update: root/package documentation references that name the old package.

**Interfaces:**
- Final workspace contains no package named `nishi-dsh-codex-antigravity`.

- [ ] Confirm every runtime source file has an owner in the new package graph.
- [ ] Delete `packages/codex-antigravity` completely.
- [ ] Search for stale `nishi-dsh-codex-antigravity` references and remove them except historical design notes explicitly describing the transition.
- [ ] Verify package graph is one-way: primary-web-search -> codex + antigravity.
- [ ] Commit as `refactor: remove combined provider package`.

### Task 5: Resume Claude package migration

**Files:**
- Create/complete: `packages/claude-code/**` from accepted private baseline.

**Interfaces:**
- Produces `nishi-dsh-claude-code@0.1.0-rc.1` independently of the other provider packages.

- [ ] Finish package-local deterministic tests.
- [ ] Keep config/orchestrator cross-task tests deferred to Orchestrator migration.
- [ ] Commit as `feat: migrate Claude Code provider`.

### Task 6: Verification checkpoint

- [ ] Compare branch against the pre-split commit and review changed-file ownership.
- [ ] Confirm manifests have the intended names/versions/exports/dependencies.
- [ ] Confirm no transitional combined package remains.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, and `pnpm build` when an executable runner becomes available.
- [ ] Until the runner is available, record verification as `BLOCKED_BILLING` rather than PASS.
