# Roadmap

Status updated for `0.1.0-rc.3` after reopening Core and Project Memory against DSH `0.1.2-alpha.1`.

This file owns **task status and order only**. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## Foundation compatibility remediation

The previous Core and Project Memory acceptance remains valid for the installed DSH `0.1.1-rc.2` baseline. The source/runtime blockers found against official tag `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) are now corrected and individually validated. Foundation status remains **REOPENED** only until the final supported-family validation/re-freeze passes.

### Core — REOPENED pending final family re-freeze

Previously accepted rc.2-baseline behavior remains:

- provider registry and shared registration;
- canonical provider ids/routes;
- provider-neutral runtime boundary;
- routed web search with fail-closed route handling and no fallback;
- normalized usage domain and dynamic provider roster;
- browser stale-async protection and data-driven provider presentation;
- shared `VendorFailure` contract;
- no direct Core dependency on provider packages, `dsh-subagent` or `dsh-authorization`;
- registry-first Cordis lifecycle and real DSH boot/unload-remount acceptance.

Current remediation:

- [x] Core host RPC compatibility across DSH `0.1.1-rc.2` and `0.1.2-alpha.1`; retired `dsh-host-apiproxy` production boundary removed; rc.2/alpha.1 mount-unmount-remount + security probes PASS on `59512d51e55f8121eccdb934e01523e4436b289c`.
- [x] Core browser entry migrated away from retired production `dsh-client-runtime`; Cordis/client service context works against rc.2 and disposable alpha.1.
- [x] Registry observer/transaction correction PASS on `b925e2a328168e7c978126fc6474b7af11d7a63d`: change notifications are non-vetoing, expected usage policy/collector/default-policy failures are preflighted before registry mutation, post-record rollback remains intact.
- [x] Core production DSH peers reconciled to the exact validated family `0.1.1-rc.2 || 0.1.2-alpha.1`; local/dev DSH graph remains pinned to rc.2 for reproducibility and retired rc.2 seams remain dev-only fixtures.
- [ ] Final joint rc.2 + alpha.1 validation and re-freeze with Project Memory.

### Project Memory — REOPENED pending final family re-freeze

Previously accepted root/path/context behavior remains unless a new regression proves otherwise.

Current remediation:

- [x] Maintenance route is selected when the exact maintenance inbox message is claimed, before prompt assembly; first request uses the requested provider/model. Gemini + disposable alpha.1 probe PASS on `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`.
- [x] Inter-process per-file RMW serialization PASS on `eae9caf03f8896f344d7c73b2f67d67cb9f86e9c`: 29/29 package tests, full workspace gates, child-process stress, foreign-lock preservation, symlink safety and disposable alpha.1 lock probe PASS.
- [x] Compound named-topic + Memory-map transaction PASS on `dbe1b7a3894bc05c1c4863148060bff59166bc17`: 39/39 package tests, 277/277 workspace tests, map preflight before topic mutation, late-map rollback under held locks, exact-byte restore, explicit rollback-failure aggregation and actual model-facing tool-path coverage PASS.
- [x] Project Memory production DSH peers reconciled to the exact validated family `0.1.1-rc.2 || 0.1.2-alpha.1`; local/dev DSH graph remains pinned to rc.2.
- [ ] Final joint rc.2 + alpha.1 validation and re-freeze with Core.

## Current sequence

Foundation remediation must finish before provider cleanup resumes.

### 1. Core + Project Memory final supported-family re-freeze

Run one final dual-generation validation of the complete corrected foundation, including package/peer boundaries, local rc.2 workspace gates and disposable alpha.1 Core/Memory installation/runtime probes. If PASS, mark both packages frozen again.

### 2. Codex

- [ ] Replace remaining provider-local failure/string-builder logic with the core failure contract where applicable.
- [ ] Remove provider-local copies of genuinely provider-neutral helpers where a shared contract already exists.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Live proof that vendor-native memory/project-doc injection is suppressed on the primary invocation.
- [ ] Freeze Codex.

### 3. Antigravity

- [ ] Replace remaining provider-local failure/helper duplication with core contracts where applicable.
- [ ] Remove hardcoded model-family catalog filtering while preserving malformed-entry rejection.
- [ ] Add catalog/model-list parser coverage.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Mid-conversation model switch PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Freeze Antigravity.

### 4. Claude

Claude remains usage-only for rc.3.

- [ ] Remove remaining provider-local failure/helper duplication where applicable.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Official CLI usage-source smoke PASS.
- [ ] Confirm descriptor remains model-route/search-free.
- [ ] Freeze Claude.

### 5. Repository-wide provider invariants

- [ ] Provider packages do not bypass the shared registration path for LLM adapter registration.
- [ ] Vendor-specific subagent registrations/tools remain absent.
- [ ] Core remains independent of provider packages.
- [ ] Every model capability has at least one canonical route.
- [ ] Providers without model capability serve no model route.
- [ ] Capability absence remains supported.
- [ ] Synthetic fourth-provider extension test remains green.

### 6. Product-level live acceptance

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

### 7. Install/profile lifecycle

- [ ] Fresh disposable rc.3 tarball install PASS.
- [ ] Same-profile reconciliation/update PASS.
- [ ] Existing `dsh-chatgpt-web` link preserved.
- [ ] Managed Orchestrator `preset install` / `status` / `update` / `remove` PASS.
- [ ] Normal Suite removal preserves unrelated profile/session/project/vendor state.

### 8. Release gate

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
