# Roadmap

Status updated for `0.1.0-rc.3` after final Core and Project Memory acceptance.

This file owns **task status and order only**. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## Frozen foundation

### Core — DONE / FROZEN

Completed and accepted:

- provider registry and shared transactional registration;
- canonical provider ids/routes;
- provider-neutral runtime boundary;
- routed web search with fail-closed route handling and no fallback;
- normalized usage domain and dynamic provider roster;
- browser stale-async protection and data-driven provider presentation;
- shared `VendorFailure` contract;
- removal of direct core `dsh-subagent` / `dsh-authorization` dependencies;
- unfamiliar fourth-provider extension proof;
- final registry-first Cordis lifecycle;
- real DSH host boot, `/web-search` agent mount and unload/remount acceptance.

Do not schedule discretionary Core cleanup for rc.3. Reopen only for a reproducible blocker.

### Project Memory — DONE / FROZEN

Completed and accepted:

- one project-root policy for context and tools;
- nested Git/worktree root handling and non-Git fallback;
- no split-brain nested `.dsh/memory` tree;
- canonical path/symlink confinement;
- `@deepseek-ai/dsh-atomic-write` replacement writes;
- `/memory` and `/consolidate` with `commands + llm` injection;
- repository-shared memory policy excluding secrets/transient/operator-personal data;
- disposable Suite install and real DSH boot acceptance.

Do not schedule discretionary Project Memory cleanup for rc.3. Reopen only for a reproducible blocker.

## Current sequence

Finish and freeze providers one by one.

### 1. Codex

- [ ] Replace remaining provider-local failure/string-builder logic with the core failure contract where applicable.
- [ ] Remove provider-local copies of genuinely provider-neutral helpers where a shared contract already exists.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Live proof that vendor-native memory/project-doc injection is suppressed on the primary invocation.
- [ ] Freeze Codex.

### 2. Antigravity

- [ ] Replace remaining provider-local failure/helper duplication with core contracts where applicable.
- [ ] Remove hardcoded model-family catalog filtering while preserving malformed-entry rejection.
- [ ] Add catalog/model-list parser coverage.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Mid-conversation model switch PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Freeze Antigravity.

### 3. Claude

Claude remains usage-only for rc.3.

- [ ] Remove remaining provider-local failure/helper duplication where applicable.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Official CLI usage-source smoke PASS.
- [ ] Confirm descriptor remains model-route/search-free.
- [ ] Freeze Claude.

### 4. Repository-wide provider invariants

- [ ] Provider packages do not bypass the shared registration path for LLM adapter registration.
- [ ] Vendor-specific subagent registrations/tools remain absent.
- [ ] Core remains independent of provider packages.
- [ ] Every model capability has at least one canonical route.
- [ ] Providers without model capability serve no model route.
- [ ] Capability absence remains supported.
- [ ] Synthetic fourth-provider extension test remains green.

### 5. Product-level live acceptance

Use one deliberate quota-spending run after provider work is frozen:

- [ ] Codex primary + Project Memory + routed search.
- [ ] Antigravity primary + routed search.
- [ ] Antigravity model switch inside one conversation.
- [ ] **Codex -> Antigravity provider switch inside one session.**
- [ ] Memory written before the switch is readable after it.
- [ ] Usage & Limits with all providers mounted.
- [ ] Profile without Antigravity leaves no placeholder.
- [ ] Late-mounted provider appears in the browser without provider-specific browser changes.
- [ ] Model Accounts compatibility surface works without Nishi-managed vendor OAuth.

Automatic failover remains deferred. Manual route switching ships first.

### 6. Install/profile lifecycle

- [ ] Fresh disposable rc.3 tarball install PASS.
- [ ] Same-profile reconciliation/update PASS.
- [ ] Existing `dsh-chatgpt-web` link preserved.
- [ ] Managed Orchestrator `preset install` / `status` / `update` / `remove` PASS.
- [ ] Normal Suite removal preserves unrelated profile/session/project/vendor state.

### 7. Release gate

- [ ] `pnpm install --frozen-lockfile` exit 0.
- [ ] `pnpm verify:local` exit 0.
- [ ] `pnpm smoke:vendor-cli` exit 0.
- [ ] `pnpm verify:bundle-install` exit 0.
- [ ] `pnpm check:npm-names` exit 0.
- [ ] `RELEASE.md` updated with final evidence.
- [ ] Breaking changes reviewed.
- [ ] Explicit maintainer publication approval obtained.

Current release state: **NOT READY TO PUBLISH**.

## Deferred after rc.3

- Personal memory store under `$DSH_HOME` with hard separation from repository memory.
- Real Grok provider plugin.
- Decision on guarded `memory_delete` vs rewrite/edit-only pruning.
- Stronger Antigravity native-memory/tool enforcement if vendor APIs allow it.
- Windows acceptance before any Windows compatibility claim.
