# Roadmap

Status updated for `0.1.0-rc.3` after accepted Foundation revalidation against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`), which is the only supported DSH generation; rc.2 and earlier are unsupported. `docs/README.md` owns that policy.

This file owns task status and order only. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## 1. Foundation — THAWED, PENDING RE-VALIDATION

A follow-up audit of Core, Project Memory and Codex reopened this freeze again. It reproduced a Project Memory recovery race that failed unrelated memory operations, a Codex path that put raw vendor stderr in front of the model, and a set of smaller correctness and architecture defects. All were remediated; see `docs/HANDOFF.md` for the itemized list.

Local re-validation of this tree first returned FAIL — `pnpm verify:local` gave FAIL, PASS, PASS over three runs, on a load-sensitive Project Memory recovery read race that failed an unrelated caller's memory operation. That defect is fixed and the gate is now green: `pnpm verify:local` 5/5, Core `209`, Project Memory `77`, Codex `61`. A single `build`/`check`/`test` pass exited `0` throughout, which is why the defect was missed — treat that as the weaker signal it is. See `docs/HANDOFF.md`. There is still **no** independent validation, live acceptance or alpha.1 runtime probe against this tree. The freeze claim below is history.

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

Supported DSH generation: `0.1.2-alpha.1` only.

Foundation production DSH peers declare exactly that:

```text
0.1.2-alpha.1
```

The devDependency graph matches, so the alpha.1 claim rests on the whole workspace suite running against alpha.1, not on a one-off probe.

## Architectural overcomplexity disposition

### Simplified and accepted

- [x] duplicate Project Memory recovery at the tool wrapper removed; domain operations remain the single recovery boundary;
- [x] implicit PID/pathname ownership replaced with explicit transaction ids, lock tokens and process identities.

### Intentionally retained

- [ ] Core authorization client begin/submit/cancel/polling state machine: exported client API; consider removal only as a separately reviewed compatibility cleanup.
- [ ] `registerConnectionRpcChannel()` `Function.length` rc2/alpha compatibility probe: **removal debt**, not retained compatibility — rc2 is unsupported. Remove it together with the peer-range narrowing, in that gated change.
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

- [x] provider-specific audit of source, tests and manifest;
- [x] regression net before changing anything: 7 -> 26 unit tests, driven through the public seam with a fake subprocess, characterizing catalog, vendor-diagnostic and native-tool behaviour;
- [x] route every vendor-process diagnostic through `VendorFailure`; raw stderr and stdout no longer reach a message (30 tests);
- [x] remove hardcoded model-family catalog filtering while preserving malformed-entry rejection. The speculative JSON object-walker was deleted outright — it looked for `slug`/`id`/`model_id` keys the vendor never emits, so the JSON path yielded zero models against the real CLI and the text fallback always ran. Both paths now share one parser over the real `id\tname` format: any id is accepted regardless of family, and rejection is by shape — no tab, empty id, or whitespace inside an id. The `Fetching available models...` progress line is skipped by those rules, not by matching its wording. A non-`SUCCESS` envelope is now an authoritative failure instead of a silent fallback, and its vendor-authored `error` string is sanitized through `VendorFailure` like every other vendor output;
- [ ] remove genuinely provider-neutral duplication;
- **accepted debt — no vendor runtime version verification.** Codex pins `0.150.0` and enforces it from the App Server handshake; Antigravity runs whatever `agy` is installed, at any version. `agy` exposes no handshake, so an equivalent gate would mean parsing `agy --version` and gating on a known-good range. Deliberately not done for now: the maintainer accepted the risk on 2026-08-30. Revisit if a vendor upgrade ever breaks a contract silently;
- **accepted debt — `usage-source.ts` trust model.** It sets `rejectUnauthorized = false` for loopback HTTPS quota probes and discovers the port and CSRF token by scanning process command lines; 534 lines with no unit tests. Any local process that binds the same loopback port with a self-signed certificate would be believed. Bounded blast radius — loopback only, read-only quota reporting — and the maintainer accepted it as-is on 2026-08-30. Revisit if usage ever carries anything beyond quota numbers;
- [x] live acceptance: primary 8/8 (catalog, real turn, tool loop, shared memory, session reopen, model switch, isolation, failure semantics), routed search 1/1, native search 1/1 — all against the real `agy 1.1.22` with no permission-config changes;
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

## 7b. DSH support boundary — alpha.1 only — DONE except the upstream blocker

`0.1.2-alpha.1` is the only supported DSH generation, and the repository now says so everywhere rather than only in policy.

- [x] Foundation devDependency/test baseline moved from rc.2 to alpha.1, resolved from the local upstream checkout through `pnpm-workspace.yaml` overrides;
- [x] Core and Project Memory peers narrowed to `0.1.2-alpha.1`;
- [x] provider peers (`codex`, `antigravity`, `claude`) moved to `0.1.2-alpha.1`, each on its own evidence — Codex 61 unit tests plus 15 live scenarios, Antigravity 38 plus 11, Claude 7 unit tests only and correspondingly weaker;
- [x] the Suite's `dsh-authorization` dependency and `DSH_COMPATIBILITY_VERSION` moved;
- [x] `registerConnectionRpcChannel()`'s `Function.length` arity probe removed with the rc.2 branch it selected; the named seam stays because it records that Connection owns the disposer;
- [x] Core's retired rc.2 dev fixtures (`dsh-client-runtime`, `dsh-host-apiproxy`) dropped; the invariant that they stay out of `dependencies`/`peerDependencies` and out of production imports remains;
- [ ] **blocked on upstream**: publish `0.1.2-alpha.1` to npm. Until then the declared ranges are uninstallable from the registry, which gates publication rather than development;
- [ ] once published, replace the local-checkout overrides in `pnpm-workspace.yaml` with ordinary registry versions and delete the *Local setup* note in `docs/README.md`.

Two rc.2 literals survive on purpose: the provenance line in `packages/codex/THIRD_PARTY_NOTICES.md`, which is a historical fact about what the code was derived from, and a comment in `packages/suite/cordis.patch.yml` describing an rc.2 launcher bug. That second one is worth re-checking: if alpha.1 preserves third-party preset roots, the Suite's managed preset bridge is obsolete and should be removed rather than carried forward.

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
- Core's `tsdown` build is not reproducible: two builds of an unchanged tree emit a different `lib/client.js`, differing only in CSS-module key order. Harmless today, but it makes byte-level artifact comparison useless.
