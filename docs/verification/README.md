# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, fold the durable result into this ledger. Older raw reports and removed acceptance documents remain available through git history; do not recreate them as new dated files.

## Environment baselines

Accepted local validation uses:

- Node `v24.19.0` from fnm;
- pnpm `11.21.0`;
- installed DSH `0.1.1-rc.2`;
- Linux/CachyOS local environment;
- GitHub Actions/hosted CI: not used;
- Windows: **NOT TESTED**.

The reopened compatibility audit additionally treats official upstream tag `dsh-v0.1.2-alpha.1` at commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` as the source target. Alpha.1 compatibility probes must use actual upstream source/runtime contracts; DSH documentation is secondary when it disagrees or lags.

## Core stabilization baseline

Core 01–14 remain accepted for the DSH `0.1.1-rc.2` baseline. The package is **REOPENED** for alpha.1 compatibility/integrity remediation; old acceptance is not being erased.

| Gate | Accepted result |
|---|---|
| Core 01 | usage lifecycle/race safety PASS |
| Core 02 | UTF-8 streaming split-chunk decoding PASS |
| Core 03 | canonical provider ids/routes PASS |
| Core 04 | workspace confinement PASS |
| Core 05 | transactional provider registration rollback PASS for covered rc.2 failure classes |
| Core 06 | registered provider without usage capability remains visible as unsupported PASS |
| Core 07 | browser/client stale async lifecycle protection PASS |
| Core 08 | shared `VendorFailure` contract/recognizer behavior PASS |
| Core 09 | direct core `dsh-subagent` dependency removed PASS |
| Core 10 | provider-neutral boundary + unfamiliar fourth-provider extension proof PASS |
| Core 11 | root injection/lifecycle boundary PASS after correction |
| Core 12 | direct core `dsh-authorization` dependency removed PASS |
| Core 13 | canonical Web Search route parsing/error taxonomy PASS |
| Core 14 | final package/install/real DSH boot/unload-remount acceptance PASS |
| Core 15 | DSH rc.2/alpha.1 Connection + browser-client compatibility migration PASS |
| Core 16 | registry observer non-vetoing semantics + registration preflight/rollback integrity PASS |

Core 14 included full local workspace gates, six rc.3 tarballs, disposable Suite installation, installed Core subpath imports, real host boot/HTTP readiness, real agent-plane `nishi-dsh-core/web-search`, and unload/remount without duplicate registry/usage/RPC services.

### Core 15 Connection/client compatibility

Accepted implementation HEAD: `59512d51e55f8121eccdb934e01523e4436b289c`.
Gemini raw validation report commit: `c991bb6ece48acb02d5c15bce3b2b970c3da391a`.

Accepted result:

- frozen lockfile install PASS with no package/lockfile drift;
- Core tests PASS: 169/169;
- typecheck PASS;
- build PASS;
- actual rc.2 `HostConnectionRpc.handle.length === 3` and alpha.1 `handle.length === 2` verified from built packages;
- compatibility helper dispatches rc.2 registrations with `{ authority: 'trusted-host' }` and alpha.1 registrations with the native two-argument API;
- Usage Limits and Authorization channels mount/unload/remount cleanly on both DSH generations with no duplicate routes;
- production Core no longer imports or peers on retired `@deepseek-ai/dsh-host-apiproxy` or `@deepseek-ai/dsh-client-runtime`; they remain dev-only rc.2 fixtures;
- RPC success/error wire shapes remain compatible across both generations;
- Core browser entry using Cordis `Context` works with rc.2 and alpha.1 client service merges;
- disposable alpha.1 host/client probe PASS;
- alpha.1 Connection Host/Origin fence plus browser authentication were verified before Core handlers, with untrusted requests rejected (403) and unauthenticated requests rejected (401).

### Core 16 registry transaction integrity

Accepted implementation HEAD: `b925e2a328168e7c978126fc6474b7af11d7a63d`.
Gemini raw validation report commit: `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

Accepted result:

- Core tests PASS: 175/175;
- Core typecheck/build PASS;
- full monorepo test/check/build PASS;
- frozen lockfile PASS with no package/lockfile drift;
- synchronous and async registry observer failures are non-vetoing, diagnostically logged and do not starve later observers;
- async observer rejection produces no unhandled rejection;
- `record()` always returns a usable withdrawal handle after a committed registration;
- provider/routes cleanly withdraw through real Cordis service proxies even with broken observers;
- post-record install failure still rejects with the original failure and rolls back registry + adapter state;
- stale disposer cannot remove a replacement provider generation;
- explicit usage policy is validated/detached before capability factories and registry mutation;
- usage collector shape is validated/bound after its factory but before registry mutation;
- invalid host default usage policy fails before registry observer setup;
- valid default/explicit policy reconciliation and usage refresh PASS;
- behavior aligns with alpha.1 DSH's non-vetoing topology-observer principle while intentionally avoiding a post-commit rethrow that would recreate disposer loss for this registry API.

Core source/runtime blockers found by the reopened audit are now closed. Core remains formally REOPENED only until supported DSH peer ranges and the final foundation re-freeze are handled together after Project Memory integrity remediation.

## Project Memory stabilization baseline

PM01 and PM02 remain accepted for the DSH `0.1.1-rc.2` baseline. Project Memory is **REOPENED** for compatibility/integrity remediation.

| Gate | Accepted result |
|---|---|
| PM01 | one root policy for context/tools; nested Git/worktree/non-Git cases PASS |
| PM02 | package/workspace + atomic-write + Cordis commands/llm + disposable real DSH boot PASS |
| PM03 | maintenance route selection before prompt assembly; first maintenance request uses selected provider/model PASS |

Accepted PM01/PM02 behavior includes no nested split-brain `.dsh/memory` tree, canonical path/symlink refusal, atomic replacement writes, `commands + llm` injection for maintenance commands, and repository-shared memory policy excluding secret/transient/operator-personal data.

### PM03 maintenance route timing

Accepted implementation/test commits:

- `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1` — select maintenance route on the exact `agent/inbox/claimed` event before prompt assembly;
- `b3948f3443fc7d0418b64c688865fb7c0ec9eebf` — regression coverage for first-step prompt variables/request route and listener cleanup.

Gemini validated tested HEAD `b3948f3443fc7d0418b64c688865fb7c0ec9eebf` and pushed raw report commit `10020983856a1137f286c83f9ed68c0a62605f58`.

Accepted result:

- Project Memory unit tests PASS: 25/25;
- typecheck PASS;
- build PASS;
- upstream alpha.1 lifecycle verified as `inbox.claim` / `agent/inbox/claimed` before `systemPrompt.assemble`, with `agent/pre-step` later;
- alpha.1 `installModelSelection` snapshots `selection.current` during prompt assembly and applies the snapshot during `agent/request`;
- first maintenance request receives the requested provider/model;
- unselected inherited reasoning effort is removed as required by DSH model-selection semantics;
- cleanup on idle, error, turn-stopping and steer failure PASS;
- disposable probe using actual alpha.1 `installModelSelection` PASS with zero lingering listeners;
- `agent/inbox/claimed` compatibility with installed rc.2 baseline confirmed.

PM03 closes only the maintenance-route timing blocker. Inter-process RMW integrity and compound topic/map mutation failure semantics remain open in `ROADMAP.md`.

## Documentation consolidation

Current documentation structure and source-of-truth rules were previously accepted after a full Gemini rerun on commit `efabdf0f10fc4851a2446bab8678417fa9b3af88`.

Accepted properties remain:

- current state lives in the small canonical document set;
- `docs/verification/README.md` is the durable ledger;
- `docs/verification/gemini/LATEST.md` is the only rolling raw Gemini report;
- old plans/specs/session summaries/acceptance reports remain in git history rather than the current tree.

Future agents must update canonical docs in place rather than creating new dated reports.

## Codex live-probe contract repair

The stale Codex primary live fixture was corrected and accepted on commit `4c75129a7f766d415182441d91ed1e8e1ca8a50d`.

Accepted result:

- live primary fixture uses the registry-first rc.3 contract without a `subagents` service;
- obsolete vendor-specific subagent live acceptance removed;
- executable override uses `env.DSH_CODEX_EXECUTABLE`;
- provider `codex` / route `codex-app-server` register successfully;
- Codex tests PASS: 31/31;
- typecheck/build PASS;
- real `test:live:primary` PASS with `gpt-5.6-sol` returning `CODEX_PRIMARY_OK`;
- adapter/process teardown clean.

Provider cleanup remains paused until the reopened foundation remediation is complete.

## Historical release/acceptance baseline

Published `0.1.0-rc.1` historically passed Linux/CachyOS local and registry-only installation smoke. rc.2 was intentionally parked unpublished after local/live work. Exact old evidence remains in git history.

## Current open validation

Ordered open validation is now:

1. Project Memory inter-process RMW integrity.
2. Project Memory compound topic/map mutation failure semantics and focused test gaps.
3. Supported DSH peer/dev range reconciliation + Core/Project Memory re-freeze.
4. Codex provider cleanup + focused/local/live acceptance.
5. Antigravity provider cleanup/catalog + focused/local/live acceptance.
6. Claude usage-only cleanup/smoke.
7. Repository-wide provider invariants.
8. Cross-provider/product live acceptance.
9. Final profile/install/release gates.

See `docs/ROADMAP.md` for task status and `docs/HANDOFF.md` for the immediate next run.

## Validation workflow

For each issue Gemini should:

1. pull the current branch;
2. use the exact Node 24.19.0 fnm path;
3. run only the requested local gates/review;
4. not modify implementation unless explicitly permitted;
5. overwrite `docs/verification/gemini/LATEST.md` with tested commit, environment, commands, findings and PASS/FAIL;
6. commit/push only the allowed rolling report.

After PASS, update this ledger only with durable facts. Do not append raw command transcripts or create a permanent file per validation.
