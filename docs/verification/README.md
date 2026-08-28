# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, fold durable facts here. Older raw reports and superseded acceptance detail remain available through git history; do not recreate dated report files.

## Environment baseline

Accepted local validation baseline:

- Node `v24.19.0` from fnm;
- pnpm `11.21.0`;
- installed DSH `0.1.1-rc.2`;
- Linux/CachyOS;
- GitHub Actions/hosted CI: not used;
- Windows: **NOT TESTED**.

Compatibility work also uses official upstream DSH tag:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Actual upstream source/runtime contracts at that exact tag/commit are primary truth when documentation lags.

## Core — FROZEN

Core 01–16 are accepted.

| Gate | Accepted result |
|---|---|
| Core 01 | usage lifecycle/race safety PASS |
| Core 02 | UTF-8 streaming split-chunk decoding PASS |
| Core 03 | canonical provider ids/routes PASS |
| Core 04 | workspace confinement PASS |
| Core 05 | transactional provider registration rollback PASS |
| Core 06 | provider without usage capability remains visible as unsupported PASS |
| Core 07 | browser stale-async lifecycle protection PASS |
| Core 08 | shared `VendorFailure` contract/recognizer PASS |
| Core 09 | direct `dsh-subagent` dependency removed PASS |
| Core 10 | provider-neutral boundary + synthetic fourth-provider extension PASS |
| Core 11 | registry-first root lifecycle/injection PASS |
| Core 12 | direct `dsh-authorization` dependency removed PASS |
| Core 13 | canonical routed Web Search/error taxonomy PASS |
| Core 14 | package/install/real DSH boot/unload-remount acceptance PASS |
| Core 15 | rc.2/alpha.1 Connection + browser-client compatibility PASS |
| Core 16 | non-vetoing registry observers + registration preflight/rollback integrity PASS |

Key reopened-audit checkpoints:

- Core 15 implementation HEAD `59512d51e55f8121eccdb934e01523e4436b289c`, raw report commit `c991bb6ece48acb02d5c15bce3b2b970c3da391a`;
- Core 16 implementation HEAD `b925e2a328168e7c978126fc6474b7af11d7a63d`, raw report commit `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

Accepted Core invariants include:

- rc.2 legacy three-argument Connection registration and alpha.1 authenticated two-argument registration both work;
- production Core does not require retired `@deepseek-ai/dsh-host-apiproxy` or `@deepseek-ai/dsh-client-runtime`;
- Connection lifecycle/unload/remount and alpha.1 transport/auth fencing PASS;
- registry observers cannot veto committed topology changes or starve later observers;
- async observer rejection is contained;
- post-record install failure rolls back Core-owned state;
- stale disposer cannot remove a replacement provider generation;
- usage policy/collector/default-policy validation happens before registry visibility where required;
- Core remains provider-independent.

## Project Memory — FROZEN

PM01–PM05 are accepted.

| Gate | Accepted result |
|---|---|
| PM01 | one root policy for context/tools; nested Git/worktree/non-Git cases PASS |
| PM02 | package/workspace + atomic-write + Cordis commands/llm + disposable real DSH boot PASS |
| PM03 | maintenance route selection before prompt assembly; first request uses selected provider/model PASS |
| PM04 | inter-process same-file RMW locking across `MEMORY.md`, topics and `.gitignore` PASS |
| PM05 | named-topic + Memory-map compound preflight/rollback/concurrency integrity PASS |

Key checkpoints:

- PM03 implementation/test through `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`, raw report commit `10020983856a1137f286c83f9ed68c0a62605f58`;
- PM04 implementation HEAD `eae9caf03f8896f344d7c73b2f67d67cb9f86e9c`, raw report commit `02e0dca62f49fc2ef6bba8626ae028c7da3986e2`;
- PM05 implementation HEAD `dbe1b7a3894bc05c1c4863148060bff59166bc17`, raw report commit `8e8c1980a34d6c9b0cbd020f0d0166e7c4c00e01`.

Accepted Project Memory invariants include:

- maintenance model selection is active on exact `agent/inbox/claimed` before prompt assembly snapshots the first request;
- cleanup removes temporary selection/listeners on idle, matching stop/error or steering failure;
- every same-file RMW writer uses the same `<target>.lock` namespace;
- real child-process stress retained independent map/topic/init updates;
- foreign locks are not deleted on timeout;
- canonical path/symlink safety remains fail-closed;
- named-topic model-facing operations use fixed lock order `MEMORY.md -> <topic>.md`;
- deterministic Memory-map failures happen before topic mutation;
- late map failure removes a new topic or restores an existing topic byte-for-byte while the topic lock is still held;
- rollback failure is explicit as `AggregateError`;
- actual registered `memory_write` / `memory_edit` use the compound path;
- rc.2 and official alpha.1 behavior PASS for the changed seams.

## Final foundation re-freeze — ACCEPTED

Final foundation implementation HEAD:

```text
0c7a177d2f4fceab58513cbd0d87fcf9c31b025b
```

This commit contains the minimal lockfile reconciliation required by the already accepted Core peer-range change. It changes only the Core lockfile specifiers for `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-tools`; resolved local versions remain `0.1.1-rc.2`.

Final raw PASS report commit:

```text
c209be795601ac7c4a3328c4af6bdbefde7f9f82
```

The raw report text contains a one-character typo in the lockfile commit SHA (`0c7a177e...`). Git history is canonical: the actual commit is `0c7a177d2f4fceab58513cbd0d87fcf9c31b025b`.

Accepted final result:

- `pnpm install --frozen-lockfile` PASS;
- Core tests `176/176` PASS;
- Project Memory tests `39/39` PASS;
- full workspace tests `270/270` PASS;
- workspace/package check + build PASS;
- `pnpm verify:local` PASS;
- six rc.3 local tarballs generated;
- packed Core/Project Memory metadata PASS;
- local resolved DSH graph remains `0.1.1-rc.2`;
- Core and Project Memory production DSH peers accept exactly `0.1.1-rc.2 || 0.1.2-alpha.1`;
- actual official alpha.1 package/source/runtime compatibility for Core and Project Memory remains PASS;
- retired Core seams remain absent from the production runtime boundary.

Foundation result:

```text
Core: RE-FREEZE ACCEPTED
Project Memory: RE-FREEZE ACCEPTED
```

Do not reopen Core or Project Memory during provider cleanup without a new reproducible regression.

## Codex accepted pre-work evidence

A stale Codex primary live fixture was repaired and accepted on commit `4c75129a7f766d415182441d91ed1e8e1ca8a50d`.

Accepted result:

- registry-first rc.3 fixture without `subagents`;
- obsolete vendor-specific subagent acceptance removed;
- executable override uses `env.DSH_CODEX_EXECUTABLE`;
- provider `codex` / route `codex-app-server` register successfully;
- Codex tests `31/31` PASS at that checkpoint;
- check/build PASS;
- real `test:live:primary` PASS with `gpt-5.6-sol` returning `CODEX_PRIMARY_OK`;
- adapter/process teardown clean.

This evidence is a starting point, not a Codex freeze. Provider-specific cleanup/compatibility/live acceptance remains active.

## Documentation structure

Canonical documentation rules were previously accepted on commit `efabdf0f10fc4851a2446bab8678417fa9b3af88`.

Current rules:

- `docs/HANDOFF.md` owns the immediate next task;
- `docs/ROADMAP.md` owns task order/status;
- `docs/ARCHITECTURE.md` owns current technical contracts;
- `docs/RELEASE.md` owns release/Market state;
- this file owns durable accepted validation;
- `docs/verification/gemini/LATEST.md` is the only rolling raw Gemini report;
- old plans/specs/session summaries/reports remain in git history.

## Current open validation

Ordered open validation is now:

1. Codex provider cleanup + provider-specific DSH compatibility + focused/local/live freeze acceptance.
2. Antigravity cleanup/catalog + provider-specific compatibility + focused/local/live freeze acceptance.
3. Claude usage-only cleanup + provider-specific compatibility/smoke.
4. Repository-wide provider invariants.
5. Cross-provider/product live acceptance.
6. Final profile/install/release gates.

See `docs/ROADMAP.md` for task status and `docs/HANDOFF.md` for the immediate next run.

## Validation workflow

For each issue Gemini should:

1. pull the current branch;
2. use the exact Node `24.19.0` fnm path;
3. run only the requested local gates/review;
4. not modify implementation unless explicitly permitted;
5. overwrite `docs/verification/gemini/LATEST.md` with tested commit, environment, commands, findings and PASS/FAIL;
6. commit/push only the explicitly allowed files.

After PASS, update this ledger only with durable facts. Do not append raw command transcripts or create permanent per-run report files.
