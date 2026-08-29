# Roadmap

Status updated for `0.1.0-rc.3` after accepted Foundation revalidation against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`).

This file owns task status and order only. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## 1. Foundation — THAWED, PENDING RE-VALIDATION

A follow-up audit of Core, Project Memory and Codex reopened this freeze again. It reproduced a Project Memory recovery race that failed unrelated memory operations, a Codex path that put raw vendor stderr in front of the model, and a set of smaller correctness and architecture defects. All were remediated; see `docs/HANDOFF.md` for the itemized list.

The tree is locally green (workspace `build`/`check`/`test` exit `0`; Core `209`, Project Memory `72`, Codex `61`) but has **no** independent validation, live acceptance or alpha.1 runtime probe against it. The freeze claim below is history.

Previously accepted implementation, now superseded:

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

## 2. Codex — THAWED, PENDING RE-VALIDATION

Independent from-scratch audit, remediation, and live acceptance testing completed:

- [x] independently audit current Codex source/runtime seams against official Codex 0.150.0 and DSH 0.1.1-rc.2;
- [x] reconcile provider-specific DSH dependencies/peers to proven generations;
- [x] remove deprecated feature flags and redundant code-mode-host flags;
- [x] fix stream error on concurrent connection close in App Server connection lifecycle;
- [x] preserve vendor protocol translation and the reviewed Codex App Server adapter boundary inside the provider package;
- [x] preserve registry-first provider registration and canonical `codex-app-server` route;
- [x] preserve absence of vendor-specific subagent registrations/tools;
- [x] focused test/check/build PASS (48/48 tests);
- [x] live primary turn PASS (`test:live:primary`);
- [x] routed native `web_search` PASS (`test:live:web-search`, `test:live:web-search-routed`);
- [x] full 15-scenario live acceptance test suite PASS (`test:live:acceptance`);
- [x] prove vendor-native persistent memory/project-doc injection is suppressed;
- [x] prove adversarial isolation against forbidden host capabilities;
- [x] prove zero process residue;
- [x] fresh accepted Codex validation evidence folded into `docs/verification/README.md`;
- [x] freeze Codex.

## 3. Antigravity — ACTIVE

Next stage:

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
