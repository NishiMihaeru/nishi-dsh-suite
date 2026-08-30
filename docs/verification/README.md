# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, durable facts are folded here. Superseded raw detail remains available through git history.

DSH generations named in this ledger are historical run facts, not support claims. The only supported DSH generation is `0.1.2-alpha.1`; `0.1.1-rc.2` and earlier are unsupported. Evidence recorded against an rc.2 baseline documents what was actually executed at that checkpoint and never establishes rc.2 as a supported target. `docs/README.md` owns the policy.

## Current validation status — SUPERSEDED, RE-VALIDATION REQUIRED

Everything recorded in this section describes the implementation checkpoint named below. A later audit of Core, Project Memory and Codex reproduced defects in all three and changed behavior in each, so **this ledger no longer describes the working tree** and must not be promoted to it.

The current tree passes a local gate: `pnpm verify:local` 5/5 exit `0`, Core `209`, Project Memory `77`, Codex `61`, Claude `7`, Antigravity `7`, Suite `12`. Reaching that took one fix — the first re-validation returned FAIL, PASS, PASS on a load-sensitive Project Memory recovery read race, itemized in `HANDOFF.md`. A local gate is still not an acceptance: there is no independent validation, no live acceptance run and no repeated alpha.1 runtime probe. Restoring a freeze claim requires producing that evidence against this tree.

The accepted evidence below is retained as history.

Accepted Foundation implementation HEAD:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Accepted Codex provider implementation validation:

```text
Codex provider independent validation PASS
Codex CLI: codex-cli 0.150.0 (tag rust-v0.150.0 / commit 3b3b4f8fb3f6403e72c2d0533ed0d2f309c59717)
DSH baseline: 0.1.1-rc.2 (commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
All 15 live acceptance scenarios PASS
```

Accepted status at that checkpoint (historical):

```text
Core: FROZEN
Project Memory: FROZEN
Codex: FROZEN
```

## Environment and compatibility baseline

Accepted local validation baseline:

- Node `v24.19.0`;
- pnpm `11.21.0`;
- local installed DSH workspace baseline `0.1.1-rc.2`;
- Linux/CachyOS, x86_64;
- GitHub Actions/hosted CI: **NOT USED**;
- Windows: **NOT TESTED**.

Authoritative compatibility target validated in a disposable upstream environment:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Actual upstream source/runtime contracts at that exact tag/commit remain primary truth when documentation lags.

Core and Project Memory retain the production peer union:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Provider packages do not inherit Foundation compatibility automatically.

## Accepted executable evidence

Fresh evidence on implementation HEAD `7cd4d5b17625f9b3a21b741555df6597fd9cb889`:

| Gate | Accepted result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| Core focused tests | `182/182` PASS |
| Core `check` | PASS |
| Core `build` | PASS |
| Project Memory focused tests | `64/64` PASS |
| Project Memory `check` | PASS |
| Project Memory `build` | PASS |
| workspace `test` | PASS |
| workspace `check` | PASS |
| workspace `build` | PASS |
| `pnpm verify:local` | PASS |
| repeated PM concurrency suites | 20/20 iterations PASS, 460 assertions total |
| lock/WAL residue inspection | PASS, zero unexpected remnants |
| bidirectional `@deepseek-ai/dsh-atomic-write` lock interoperability | PASS |
| disposable official alpha.1 runtime probes | PASS |
| hosted CI / GitHub Actions | NOT USED |
| Windows | NOT TESTED |

Workspace test counts recorded by the follow-up report were Core `182`, Project Memory `64`, Codex `31`, Suite `12`, Antigravity `7`, Claude `0`.

`pnpm verify:local` passed release-family verification, package-contract verification, Orchestrator validation, build, check, tests and local package packing.

### Follow-up race verification

The three suites that exposed the first validation failures were rerun 20 consecutive times:

- `atomic-write.test.ts`;
- `compound-transaction.test.ts`;
- `transaction-recovery.test.ts`.

Accepted result: 20/20 iterations passed with no leaked `ENOTEMPTY` / `ENOTDIR`, no concurrent-journal-open/unlink exception, and the expected fail-closed legacy owner-transfer error.

## Accepted Foundation remediation

### Project Memory

Accepted behavior now includes:

1. fixed journal pathname protected by random `transactionId` generation identity, expected-generation cleanup, and committed cleanup while participant locks remain held;
2. generation-safe populated directory writer locks with PID, random owner token and optional process-birth identity;
3. stale/finalizer lock removal conditional on the exact observed generation and directory identity;
4. PID-reuse hardening through Linux `/proc/<pid>/stat` start time and macOS process start time, with conservative fallback elsewhere;
5. bootstrap ingestion bounded before whole-file materialization;
6. recovery journal phase replacement preserving mode `0600` on POSIX;
7. domain-owned recovery with redundant tool-layer recovery removed;
8. writer-lock publication collision errno handled at the publishing `rename()` without a racy post-collision pathname re-stat for structural collision codes;
9. an opened journal concurrently unlinked before visible-identity recheck is treated as current namespace absence, while inode/symlink replacement still fails closed;
10. legacy journals without `transactionId` identify generation from immutable transaction payload while mutable owner PID/identity is checked separately.

The follow-up report independently reviewed lock ordering, ABA protection, path replacement behavior and transaction ownership separation and found no new blocking correctness defect.

### Core

Accepted behavior now includes:

1. destructive legacy-grant logout disabled/fail-closed because alpha.1 exposes no atomic compare-and-delete credential operation;
2. no `describeRecord()` then unconditional `deleteRecord()` mutation path for legacy logout;
3. browser legacy grant state is informational and has no destructive Sign Out action;
4. usage invalidation immediately removes host cache state and advances an observation generation;
5. pre-invalidation in-flight refresh cannot republish superseded state;
6. cached host reads omit invalidated state;
7. authoritative browser cache omission clears a prior local `FRESH` snapshot so `ensureFresh()` can refresh;
8. credential/backend secret material remains outside the browser RPC boundary.

## Disposable DSH `0.1.2-alpha.1` evidence

The exact upstream checkout at `cd5ef8148158c3a752a658978873241fdf8e2bbc` built successfully and the changed seams were exercised against alpha.1 runtime packages.

Accepted Project Memory probes:

- real `memory_write` with named topic + Memory-map update;
- real `memory_read` for named topic and bootstrap memory;
- real deterministic `memory_edit`;
- `ToolRunContext.signal` cancellation;
- unlocked pending recovery restoring exact pre-crash state;
- lock coordination/interoperability exercised through the validated suites.

Accepted Core probes:

- native alpha.1 two-argument Connection `rpc.handle(channel, handler)`;
- authorization status for unconfigured and legacy-grant state;
- fail-closed legacy logout with no credential deletion;
- usage invalidation/cache-drop behavior.

## First follow-up cycle — historical evidence

The first validation tested implementation HEAD:

```text
70a73869d4fa63f541906ca8b2669f2af089f46f
```

and correctly returned FAIL: Core was green, while Project Memory exposed writer-lock collision classification, concurrent journal unlink handling, and legacy recovery generation/ownership separation defects.

Narrow production fixes were applied at:

```text
e3f84ba5bfbfa75c6492919bdd8dfa9a31c98305
d1863d8712c68b369662cad081b57302300d0c5e
```

The canonical follow-up handoff update produced tested HEAD `7cd4d5b17625f9b3a21b741555df6597fd9cb889`, which then received the accepted PASS above.

## Superseded Foundation acceptance

Earlier accepted Foundation implementation checkpoint:

```text
eb95ef6425c788f63339befd0c2437f78bc8dde1
```

Earlier raw PASS report commit:

```text
f491d681390924a171211a5c0dd0c8991f6a7faf
```

That evidence remains historical for its exact checkpoint but was superseded by the later independent alpha.1 audit and the current accepted remediation checkpoint.

Older Core 01–16 and Project Memory PM01–PM05 acceptance details remain available through git history and continue to be useful only for their exact checkpoints.

## Accepted Codex provider validation

Accepted Codex provider implementation validation:

- **Codex CLI**: `codex-cli 0.150.0` (commit `3b3b4f8fb3f6403e72c2d0533ed0d2f309c59717`)
- **DSH baseline**: `0.1.1-rc.2` (commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`)
- **Focused tests**: `48/48` unit tests PASS
- **Live acceptance**: All 15 live acceptance scenarios PASS (`test-live/codex-acceptance-full.test.ts`):
  - Primary single request and multi-turn conversation
  - Dynamic DSH tools + real Project Memory tool execution + turn continuation
  - Routed native web search (`CodexSearchBackend.search()`)
  - Usage and rate-limits read (`OfficialCodexRateLimitsSource`)
  - Cancellation during active turn & tool continuation
  - Stale checkpoint / deleted vendor thread recovery from DSH history
  - Adversarial isolation against forbidden host capabilities (`HOST_CAPABILITIES_ISOLATED`)
  - Process tree cleanup (zero lingering `codex app-server --stdio` processes)

## Next open validation

Foundation and Codex are frozen. Ordered provider/product validation is now:

1. Antigravity cleanup/catalog + provider-specific compatibility + focused/local/live freeze acceptance;
2. Claude usage-only cleanup + provider-specific compatibility/smoke;
3. repository-wide provider invariants;
4. cross-provider/product live acceptance;
5. final profile/install/release gates.

See `docs/ROADMAP.md` for task status and `docs/HANDOFF.md` for the immediate next run.
