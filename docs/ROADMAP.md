# Roadmap

Status updated for `0.1.0-rc.3` after the final Core + Project Memory dual-generation re-freeze.

This file owns **task status and order only**. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## Foundation — FROZEN

Core and Project Memory remediation against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) is complete.

Final accepted foundation implementation HEAD:

```text
0c7a177d2f4fceab58513cbd0d87fcf9c31b025b
```

Final raw PASS report commit:

```text
c209be795601ac7c4a3328c4af6bdbefde7f9f82
```

Accepted final gates:

- [x] frozen install PASS;
- [x] Core `176/176` tests + check/build PASS;
- [x] Project Memory `39/39` tests + check/build PASS;
- [x] full workspace `270/270` tests + check/build PASS;
- [x] `pnpm verify:local` PASS;
- [x] packed Core/Project Memory metadata PASS;
- [x] actual rc.2 + official alpha.1 Core runtime/client compatibility PASS;
- [x] actual rc.2 + official alpha.1 Project Memory tool/locking/maintenance compatibility PASS;
- [x] production DSH peers restricted to exact `0.1.1-rc.2 || 0.1.2-alpha.1` for Core/Project Memory;
- [x] Core re-freeze accepted;
- [x] Project Memory re-freeze accepted.

Do not reopen either package during provider cleanup without a new reproducible regression.

## Current sequence

### 1. Codex — ACTIVE

- [ ] Audit current Codex source/runtime seams against installed DSH `0.1.1-rc.2` and official `0.1.2-alpha.1`; actual upstream source is primary truth.
- [ ] Reconcile Codex DSH dependencies/peers only to generations proven by the provider-specific audit; do not inherit the Core/Memory range automatically.
- [ ] Replace remaining provider-local failure/string-builder logic with the Core `VendorFailure`/recognizer contract where the behavior is provider-neutral.
- [ ] Remove provider-local copies of genuinely provider-neutral helpers where a shared Core contract already exists.
- [ ] Preserve vendor protocol translation and the reviewed Codex App Server adapter boundary inside the provider package.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Live proof that vendor-native memory/project-doc injection is suppressed on the primary invocation.
- [ ] Freeze Codex.

### 2. Antigravity

- [ ] Audit provider-specific DSH compatibility against the actual supported generations before changing its package ranges.
- [ ] Replace remaining provider-local failure/helper duplication with Core contracts where applicable.
- [ ] Remove hardcoded model-family catalog filtering while preserving malformed-entry rejection.
- [ ] Add catalog/model-list parser coverage.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Mid-conversation model switch PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Freeze Antigravity.

### 3. Claude

Claude remains usage-only for rc.3.

- [ ] Audit provider-specific DSH compatibility before changing package ranges.
- [ ] Remove remaining provider-local failure/helper duplication where applicable.
- [ ] Focused package `test` / `check` / `build` PASS.
- [ ] Official CLI usage-source smoke PASS.
- [ ] Confirm descriptor remains model-route/search-free.
- [ ] Freeze Claude.

### 4. Repository-wide provider invariants

- [ ] Provider packages do not bypass shared `registerProvider()` for LLM adapter registration.
- [ ] Vendor-specific subagent registrations/tools remain absent.
- [ ] Core remains independent of provider packages.
- [ ] Every model capability has at least one canonical route.
- [ ] Providers without model capability serve no model route.
- [ ] Capability absence remains supported.
- [ ] Synthetic fourth-provider extension test remains green.
- [ ] Whole-family DSH dependency declarations are consistent with provider-specific validation evidence.

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

- [ ] `pnpm install --frozen-lockfile` exit 0 on the final provider-frozen tree.
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
