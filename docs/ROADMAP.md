# Roadmap

Status updated for `0.1.0-rc.3` after a new independent Core + Project Memory audit strictly against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`).

This file owns task status and order only. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## 1. Foundation — REOPENED / IMPLEMENTED / PENDING VERIFICATION

The previous Foundation freeze was reopened by new concrete findings. Earlier PASS evidence remains valid only for the earlier checkpoint and is not evidence for the changed branch head.

Current remediation targets:

- [x] Project Memory: prevent delayed committed-journal cleanup from deleting the next transaction generation;
- [x] Project Memory: prevent stale-lock cleanup/finalizers from deleting a replacement live owner lock;
- [x] Project Memory: distinguish process ownership from recycled numeric PID on Linux/macOS;
- [x] Core: remove the unsafe legacy credential read-kind-then-delete mutation; fail closed because alpha.1 has no atomic compare-and-delete seam;
- [x] Project Memory: bound bootstrap ingestion before whole-file materialization;
- [x] Core: make usage invalidation authoritative for host cache and browser cached-read reconciliation;
- [x] Project Memory: keep recovery journal mode `0600` across the committed phase transition;
- [x] add deterministic regressions for journal generation, stale lock replacement, PID reuse, bounded prefix reads, journal permissions, unsafe logout and usage invalidation;
- [x] add lock-namespace interoperability regression against `@deepseek-ai/dsh-atomic-write`;
- [x] remove redundant tool-layer Project Memory recovery while preserving domain-owned recovery;
- [x] update current package/canonical documentation so the changed tree is not mislabeled frozen.

Pending executable gates:

- [ ] install/frozen-lockfile validation on the exact final head;
- [ ] Core focused tests;
- [ ] Core check/build;
- [ ] Project Memory focused tests, including new audit regressions and multi-process tests;
- [ ] Project Memory check/build;
- [ ] full workspace test/check/build;
- [ ] `pnpm verify:local`;
- [ ] official disposable DSH `0.1.2-alpha.1` runtime validation at exact upstream commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`;
- [ ] adversarial/repeat runs for journal/lock concurrency, cancellation and recovery;
- [ ] confirm zero lingering lock/WAL protocol files after exercised successful/recovery paths;
- [ ] Gemini independent code review of the changed Core + Project Memory seams;
- [ ] overwrite `docs/verification/gemini/LATEST.md` with raw PASS/FAIL evidence;
- [ ] only after accepted PASS, fold durable evidence into `docs/verification/README.md` and freeze Foundation again.

Windows remains **NOT TESTED**. Process-birth PID-reuse hardening is implemented for Linux and macOS; unsupported platforms conservatively treat a live PID as live.

Foundation production DSH peers remain:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The main devDependency graph remains rc.2, so explicit alpha.1 validation is mandatory.

## Architectural overcomplexity decision

### Simplify now

- [x] Remove duplicate Project Memory recovery at the tool wrapper; domain operations remain the single recovery boundary.
- [x] Replace implicit PID/pathname ownership assumptions with explicit transaction ids, lock tokens and process identities. This adds fields but reduces the number of ambiguous states/races.

### Keep for now

- [ ] Core authorization client begin/submit/cancel/polling state machine: currently broader than the host's read-only/fail-closed behavior, but it is exported client API. Consider removal only as a separately reviewed compatibility cleanup after Foundation verification.
- [ ] `registerConnectionRpcChannel()` `Function.length` rc2/alpha compatibility probe: brittle, but intentional while the package continues to publish rc2 support. Remove only when the supported peer boundary changes.
- [ ] Usage invalidation generation token: keep; it now fences in-flight pre-invalidation observations and has a concrete correctness role.
- [ ] Project Memory fixed journal pathname: keep for now. Generation identity plus participant locking closes the audited cross-generation race without introducing a larger WAL-directory migration.

Do not perform aesthetic refactors in the Foundation before the verification gate. Any further simplification needs a concrete invariant/API benefit and its own regression proof.

## 2. Codex — BLOCKED ON FOUNDATION RE-FREEZE

After Foundation PASS:

- [ ] independently audit current Codex source/runtime seams against its actually supported DSH generations;
- [ ] reconcile provider-specific DSH dependencies/peers only to proven generations;
- [ ] replace genuinely provider-neutral failure/helper duplication with Core contracts where appropriate;
- [ ] preserve vendor protocol translation and the reviewed Codex App Server adapter boundary inside the provider package;
- [ ] focused test/check/build PASS;
- [ ] live primary turn + routed native `web_search` PASS;
- [ ] prove vendor-native persistent memory/project-doc injection is suppressed on primary invocation;
- [ ] freeze Codex.

## 3. Antigravity

- [ ] provider-specific DSH compatibility audit;
- [ ] remove genuinely provider-neutral duplication;
- [ ] remove hardcoded model-family catalog filtering while preserving malformed-entry rejection;
- [ ] catalog/model-list parser coverage;
- [ ] focused test/check/build + live primary/model-switch/search acceptance;
- [ ] freeze Antigravity.

## 4. Claude

Claude remains usage-only for rc.3.

- [ ] provider-specific DSH compatibility audit;
- [ ] remove genuinely provider-neutral duplication where applicable;
- [ ] focused test/check/build;
- [ ] official CLI usage-source smoke;
- [ ] confirm descriptor remains model-route/search-free;
- [ ] freeze Claude.

## 5. Repository-wide provider invariants

- [ ] provider packages use shared `registerProvider()`;
- [ ] vendor-specific subagent registrations/tools remain absent;
- [ ] Core remains independent of provider packages;
- [ ] model capability always has at least one canonical route;
- [ ] capability absence remains legal;
- [ ] synthetic fourth-provider extension remains green;
- [ ] DSH dependency declarations match package-specific validation evidence.

## 6. Product-level live acceptance

- [ ] Codex primary + Project Memory + routed search;
- [ ] Antigravity primary + routed search;
- [ ] Antigravity model switch in one conversation;
- [ ] Codex -> Antigravity provider switch in one session;
- [ ] memory written before the switch is readable after it;
- [ ] Usage & Limits with all providers mounted;
- [ ] late/absent provider browser behavior;
- [ ] Model Accounts works without Nishi-managed vendor OAuth.

Automatic failover remains deferred.

## 7. Install/profile lifecycle

- [ ] fresh disposable rc.3 tarball install;
- [ ] same-profile reconciliation/update;
- [ ] preserve unrelated existing links/state;
- [ ] managed Orchestrator preset install/status/update/remove;
- [ ] Suite removal preserves unrelated profile/session/project/vendor state.

## 8. Release gate

- [ ] final `pnpm install --frozen-lockfile`;
- [ ] `pnpm verify:local`;
- [ ] `pnpm smoke:vendor-cli`;
- [ ] `pnpm verify:bundle-install`;
- [ ] `pnpm check:npm-names`;
- [ ] `RELEASE.md` updated with final evidence;
- [ ] breaking changes reviewed;
- [ ] explicit maintainer publication approval.

Current release state: **NOT READY TO PUBLISH**.

## Deferred after rc.3

- Personal memory store under `$DSH_HOME` with hard separation from repository memory.
- Real Grok provider plugin.
- Decision on guarded `memory_delete` vs rewrite/edit-only pruning.
- Stronger Antigravity native-memory/tool enforcement if vendor APIs allow it.
- Windows acceptance before any Windows compatibility claim.
