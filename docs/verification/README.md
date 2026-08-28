# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, fold durable facts here. Older raw reports and superseded acceptance detail remain available through git history; do not recreate dated report files.

## Current validation status — FOUNDATION RE-FROZEN

Core and Project Memory were reopened by an independent audit against official DSH `0.1.2-alpha.1`, remediated, and then accepted by a fresh local + disposable-alpha.1 validation run.

Current accepted foundation implementation HEAD:

```text
eb95ef6425c788f63339befd0c2437f78bc8dde1
```

Raw PASS report commit:

```text
f491d681390924a171211a5c0dd0c8991f6a7faf
```

Result:

```text
Foundation remediation validation PASS
Core: FROZEN
Project Memory: FROZEN
```

The report commit is documentation-only; the implementation actually tested by Gemini is the preceding `eb95ef6425c788f63339befd0c2437f78bc8dde1`.

## Environment baseline

Accepted local validation baseline:

- Node `v24.19.0` from fnm;
- pnpm `11.21.0`;
- installed DSH `0.1.1-rc.2`;
- Linux/CachyOS;
- GitHub Actions/hosted CI: not used;
- Windows: **NOT TESTED**.

Compatibility target validated in a disposable upstream environment:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Actual upstream source/runtime contracts at that exact tag/commit remain primary truth when documentation lags.

## Accepted foundation remediation evidence

Fresh executable evidence on implementation HEAD `eb95ef6425c788f63339befd0c2437f78bc8dde1`:

| Gate | Accepted result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| Core focused tests | `178/178` PASS |
| Core `check` | PASS |
| Core `build` | PASS |
| Project Memory focused tests | `57/57` PASS |
| Project Memory `check` | PASS |
| Project Memory `build` | PASS |
| workspace `test` | PASS |
| workspace `check` | PASS |
| workspace `build` | PASS |
| `pnpm verify:local` | PASS |
| working-tree integrity | PASS, zero implementation/canonical-doc drift during validation |
| hosted CI / GitHub Actions | NOT USED |
| Windows | NOT TESTED |

`pnpm verify:local` additionally passed release-family verification, package-contract verification, Orchestrator validation and local packing of all six rc.3 packages.

### Core remediation accepted

The independent alpha.1 audit found one Model Accounts correctness seam. Accepted behavior now includes:

- credential-store read failure projects sanitized `ERROR`, not false `NOT_CONFIGURED`;
- failed durable legacy-grant deletion returns generic internal RPC failure rather than nominal logout success;
- credential/backend secret text does not cross the RPC boundary;
- focused authorization regressions pass;
- disposable alpha.1 Connection uses the native two-argument `rpc.handle(channel, handler)` contract successfully.

No broad Core alpha.1 migration was required for Connection, LLM registration, session request-header routing, subprocess, browser ModuleLoader or UI slot composition.

### Project Memory remediation accepted

The reopened storage/cancellation/crash-consistency findings and implementation follow-ups are now accepted with executable regressions for:

- POSIX descriptor chain `projectRoot -> .dsh -> memory/local`;
- explicit symlinked workspace roots with strict real package-owned canonical directories;
- one stable `SafeDirectoryScope` across RMW lock/read/render/write;
- locked-parent replacement without redirected mutation;
- intermediate `.dsh` replacement with an external symlink without external sentinel mutation;
- complete-before-visible no-clobber first publication;
- AbortSignal cancellation during writer-lock wait;
- preservation of the exact caller cancellation reason at the model-facing tool boundary;
- mandatory settlement after cancellation/failure following a durable participant write;
- named-topic + Memory-map fixed lock order and cross-process serialization;
- `pending` WAL exact rollback after process death;
- `committed` WAL preserve-and-clean recovery;
- abandoned `pending` recovery after the Memory-map lock barrier even with a still-live recorded PID;
- fail-closed recovery ownership transfer from dead to live owner;
- fail-closed journal disappearance/incompatible mutation after recovery claim protocol begins;
- idempotent concurrent cleanup without surfacing ENOENT races;
- zero stale lock/WAL leakage in the exercised recovery paths.

The first remediation validation on `f3ee493bbea95b3ae7cc34c2c812a4dc23d6118f` correctly failed on one overly strict concurrent-removal assertion and two TypeScript `TS2322` fall-through paths. Those defects were corrected in `e5d6dbe3b36d805c7f708afb45552581455dd9c1` and `649d29f2e93e690d0ae31c65c183d2396062cfd7`, then the full gate was rerun from scratch on `eb95ef6425c788f63339befd0c2437f78bc8dde1` and passed.

### Disposable DSH `0.1.2-alpha.1` runtime evidence

The rerun verified the official upstream checkout at exact tag/commit and exercised changed seams rather than relying on old source inference.

Accepted Core alpha.1 evidence:

- native two-argument Connection RPC registration;
- `/authorization` status;
- credential-store failure containment;
- failed legacy-grant delete rejection;
- secret boundary protection.

Accepted Project Memory alpha.1 evidence:

- package imports/runtime Cordis mount;
- real `memory_write` returning a valid `WriteTopicMemoryResult` and committing the Memory map;
- real `memory_edit` returning a valid `EditTopicMemoryResult` and updating topic content;
- `memory_read` for bootstrap and named topics;
- lock-contention cancellation;
- mandatory settlement after cancellation;
- descriptor-chain parent replacement safety;
- intermediate `.dsh` symlink replacement safety;
- pending/committed WAL recovery;
- recovery ownership-transfer fail-closed behavior;
- zero lingering lock/WAL protocol files after exercised settlement paths.

Core and Project Memory therefore retain the explicit production peer union:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Provider packages do not inherit that compatibility automatically.

## Historical Core acceptance

Core 01–16 remain earlier accepted checkpoints and useful history.

| Gate | Historical accepted result |
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

Key checkpoints:

- Core 15 implementation HEAD `59512d51e55f8121eccdb934e01523e4436b289c`, raw report commit `c991bb6ece48acb02d5c15bce3b2b970c3da391a`;
- Core 16 implementation HEAD `b925e2a328168e7c978126fc6474b7af11d7a63d`, raw report commit `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

## Historical Project Memory acceptance

PM01–PM05 remain earlier accepted checkpoints and useful history.

| Gate | Historical accepted result |
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

Those older PM gates did not cover the later-discovered descriptor-chain, cancellation-after-partial-commit or WAL process-death cases; the current accepted remediation evidence above supersedes that gap.

## Historical foundation re-freeze — SUPERSEDED

Earlier foundation implementation HEAD:

```text
0c7a177d2f4fceab58513cbd0d87fcf9c31b025b
```

Earlier raw PASS report commit:

```text
c209be795601ac7c4a3328c4af6bdbefde7f9f82
```

That freeze was later reopened by the independent alpha.1 audit and is superseded by the current accepted remediation checkpoint `eb95ef6425c788f63339befd0c2437f78bc8dde1`.

## Codex accepted pre-work evidence

A stale Codex primary live fixture was repaired and accepted on commit `4c75129a7f766d415182441d91ed1e8e1ca8a50d`.

Accepted result at that checkpoint:

- registry-first rc.3 fixture without `subagents`;
- obsolete vendor-specific subagent acceptance removed;
- executable override uses `env.DSH_CODEX_EXECUTABLE`;
- provider `codex` / route `codex-app-server` register successfully;
- Codex tests `31/31` PASS;
- check/build PASS;
- real `test:live:primary` PASS with `gpt-5.6-sol` returning `CODEX_PRIMARY_OK`;
- adapter/process teardown clean.

This evidence is a starting point, not a Codex freeze. Provider-specific Codex audit/cleanup is the next active development stage.

## Documentation structure

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
