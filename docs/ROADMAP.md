# Roadmap

Status updated for `0.1.0-rc.3` after accepted Foundation revalidation against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`).

This file owns task status and order only. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## 1. Foundation — FROZEN

The previous Foundation freeze was reopened by a fresh independent alpha.1 audit. Seven concrete Core/Project Memory defects were remediated. The first independent Gemini run correctly failed on three additional Project Memory issues, narrow fixes were applied, and the complete follow-up gate passed.

Accepted implementation:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Foundation gates:

- [x] Project Memory journal-generation cleanup race fixed;
- [x] Project Memory stale-lock replacement/finalizer race fixed;
- [x] Project Memory PID-reuse ownership hardening implemented for Linux/macOS;
- [x] Core unsafe legacy credential read-kind-then-delete mutation removed/fail-closed;
- [x] Project Memory bootstrap ingestion bounded before whole-file materialization;
- [x] Core usage invalidation made authoritative for host cache and browser reconciliation;
- [x] Project Memory journal phase replacement preserves `0600` on POSIX;
- [x] writer-lock publication collision handoff race fixed;
- [x] concurrent journal open/unlink recovery preflight handled as current absence;
- [x] legacy transaction generation separated from mutable owner state;
- [x] duplicate tool-layer Project Memory recovery removed;
- [x] deterministic regression coverage retained/extended for the audited interleavings;
- [x] `pnpm install --frozen-lockfile` PASS;
- [x] Core focused tests `182/182`, check/build PASS;
- [x] Project Memory focused tests `64/64`, check/build PASS;
- [x] full workspace test/check/build PASS;
- [x] `pnpm verify:local` PASS;
- [x] three concurrency-sensitive PM suites repeated 20/20 iterations PASS;
- [x] zero unexpected lock/WAL residue after exercised success/recovery paths;
- [x] bidirectional `@deepseek-ai/dsh-atomic-write` lock interoperability PASS;
- [x] disposable official DSH `0.1.2-alpha.1` runtime validation at exact upstream commit PASS;
- [x] independent Gemini follow-up code review found no new blocking Foundation defect;
- [x] durable evidence folded into `docs/verification/README.md`.

Windows remains **NOT TESTED**. Unsupported process-identity seams remain conservative.

Foundation production DSH peers remain:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The main devDependency graph remains rc.2; the alpha.1 compatibility claim is supported by the accepted disposable exact-commit validation, not by rc.2 workspace tests alone.

## Architectural overcomplexity disposition

### Simplified and accepted

- [x] duplicate Project Memory recovery at the tool wrapper removed; domain operations remain the single recovery boundary;
- [x] implicit PID/pathname ownership replaced with explicit transaction ids, lock tokens and process identities.

### Intentionally retained

- [ ] Core authorization client begin/submit/cancel/polling state machine: exported client API; consider removal only as a separately reviewed compatibility cleanup.
- [ ] `registerConnectionRpcChannel()` `Function.length` rc2/alpha compatibility probe: retain while rc2 remains a declared peer.
- [ ] Usage invalidation generation token: retain; it fences pre-invalidation observations.
- [ ] Project Memory fixed journal pathname: retain; explicit transaction generation + locking closes the audited cross-generation race without a larger WAL-directory migration.

Do not perform aesthetic Foundation refactors during provider work.

## 2. Codex — ACTIVE

Next stage:

- [ ] independently audit current Codex source/runtime seams against the DSH generations it actually claims/supports;
- [ ] reconcile provider-specific DSH dependencies/peers only to proven generations;
- [ ] remove genuinely provider-neutral failure/helper duplication where Core now owns the contract;
- [ ] preserve vendor protocol translation and the reviewed Codex App Server adapter boundary inside the provider package;
- [ ] preserve registry-first provider registration and canonical `codex-app-server` route;
- [ ] preserve absence of vendor-specific subagent registrations/tools;
- [ ] focused test/check/build PASS on the final Codex tree;
- [ ] live primary turn PASS;
- [ ] routed native `web_search` PASS;
- [ ] prove vendor-native persistent memory/project-doc injection is suppressed on primary invocation where required by the current contract;
- [ ] independent provider-specific lifecycle/security/complexity review;
- [ ] fresh accepted Codex validation evidence;
- [ ] freeze Codex.

Historical Codex pre-work evidence is a starting point only, not the final freeze for this stage.

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
