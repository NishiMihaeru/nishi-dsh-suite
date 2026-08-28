# Foundation Remediation Validation Report: Core & Project Memory

- **Result**: `PASS`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested Implementation HEAD**: `eb95ef6425c788f63339befd0c2437f78bc8dde1`
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - OS: Linux (CachyOS / kernel 6.18, x86_64)
  - Hosted CI / GitHub Actions: **NOT USED** (local execution only)
  - Windows: **NOT TESTED**
- **DSH Baselines**:
  - Local installed baseline: `0.1.1-rc.2`
  - Upstream compatibility target: `deepseek-ai/deepseek-harness` at tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

---

## Executive Summary

Validation of the Foundation Remediation for **Core** (`nishi-dsh-core`) and **Project Memory** (`nishi-dsh-project-memory`) on implementation HEAD `eb95ef6425c788f63339befd0c2437f78bc8dde1` resulted in **PASS**.

- **Project Memory focused gates**: **PASS** (57/57 tests passed, TypeScript check clean with zero errors, tsconfig build clean).
- **Core focused gates**: **PASS** (178/178 tests passed, TypeScript check clean, tsdown build clean).
- **Full workspace gates**: **PASS** (`pnpm test`, `pnpm check`, `pnpm build` completed with exit code `0`).
- **Local repository verification (`pnpm verify:local`)**: **PASS** (all stages succeeded: `verify:release-family`, `verify:package-contracts`, `test:orchestrator`, `build`, `check`, `test`, `pack:local`).
- **Disposable Upstream DSH 0.1.2-alpha.1 compatibility gate**: **PASS** (both Core and Project Memory verified against official tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`).
- **Previous FAILs Resolution**:
  1. `test/filesystem-race.test.ts`: `concurrent safe removals converge without surfacing ENOENT races` **PASS**;
  2. `src/topics.ts`: TS2322 eliminated for `writeTopicMemoryWithMap` and `editTopicMemoryWithMap`, check and build exit `0`.
- **Working Tree Integrity**: **PASS** (0 bytes drift in tracked implementation, manifests, or canonical documentation).

---

## 1. Initial State & Frozen Install Gate

### 1.1 Initial Environment Checks
| Command | Exit Code | Output / Detail |
|---|---|---|
| `git switch feat/core-provider-plugins-rc3` | `0` | Switched to / already on branch |
| `git pull --ff-only` | `0` | Fast-forwarded to `eb95ef6425c788f63339befd0c2437f78bc8dde1` |
| `git rev-parse HEAD` | `0` | `eb95ef6425c788f63339befd0c2437f78bc8dde1` (exact match) |
| `git status --short` | `0` | Working tree clean |
| `node --version` | `0` | `v24.19.0` |
| `pnpm --version` | `0` | `11.21.0` |

### 1.2 Frozen Install Gate
- Command: `pnpm install --frozen-lockfile`
- Exit code: `0`
- Result: **PASS** (`Already up to date in 370ms`).
- Post-install `git status --short`: clean (0 modified files).

---

## 2. Project Memory Focused Gates

### 2.1 Summary of Project Memory Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `0` | **PASS** | 57 tests executed: **57 passed**, 0 failed |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean (0 errors) |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | **PASS** | `tsc -p tsconfig.json` clean (declarations + JS emitted) |

### 2.2 Confirmation of Previous Defect Fixes

#### A. Race Test: `test/filesystem-race.test.ts`
- **Test**: `concurrent safe removals converge without surfacing ENOENT races`
- **Result**: **PASS** (`✔ concurrent safe removals converge without surfacing ENOENT races (26.009977ms)`).
- **Verification**:
  - Idempotent convergence: `results.some(Boolean)` reports `true`;
  - Final target path is completely absent;
  - No uncaught `ENOENT` error surfaced during 32 concurrent removal calls.

#### B. Return Typing: `src/topics.ts`
- **Seam**: `writeTopicMemoryWithMap` and `editTopicMemoryWithMap`
- **Result**: **PASS** (Zero TS2322 errors; `check` and `build` exit `0`).
- **Verification**: Catch blocks properly return `rollbackJournaledTransaction(...)` (preserving the `Promise<never>` / non-`undefined` signature).

### 2.3 Regressions Status in Project Memory
- **Static symlink / canonical path safety**: **PASS** (`bootstrap write refuses a pre-existing symlink target`, `topic write refuses a pre-existing symlink target`, `K/L/N/O symlink security`).
- **Symlinked explicit workspace root**: **PASS** (`direct bootstrap creation keeps a symlinked explicit project root usable`, `direct topic write keeps a symlinked explicit project root usable`, `initialization keeps a symlinked explicit project root usable`).
- **Replacement of locked parent directory during RMW**: **PASS** (`writer scope never redirects a locked RMW into a replacement parent directory`).
- **Replacement of intermediate `.dsh` with external symlink**: **PASS** (`child directory scope never follows a swapped canonical parent symlink`).
- **AbortSignal cancellation while waiting for writer lock**: **PASS** (`writer lock cancellation rejects before a contended lock is released and never runs the mutation`).
- **Mandatory settlement after cancellation following a durable participant write**: **PASS** (`mandatory settlement on the same scope can restore a durable participant after caller cancellation`).
- **Compound MEMORY.md + topic serialization**: **PASS** (`separate processes serialize compound writes through MEMORY.md and preserve every topic/map pair`).
- **Pending transaction rollback**: **PASS** (`pending recovery restores exact pre-transaction state after process death between participant commits`).
- **Committed transaction preserve-and-clean recovery**: **PASS** (`committed recovery preserves both new participants and only cleans dead locks and journal`).
- **Abandoned pending transaction with still-live PID after MEMORY.md lock barrier**: **PASS** (`a pending journal owned by this live process is recoverable once the Memory map lock is free`, `a new Memory-map transaction settles abandoned pending state after acquiring the map lock`).
- **Recovery owner transfer to another live process -> fail closed**: **PASS** (`recovery fails closed if a dead-owner journal is transferred to a live owner before claim`).
- **Zero stale lock / journal leakage**: **PASS** (all recovery and stress tests verify clean lock and journal removal).

---

## 3. Fresh Core Focused Gates

### 3.1 Summary of Core Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 178 tests executed: **178 passed**, 0 failed |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean (0 errors) |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` built all ESM/CJS bundles and declaration files |

### 3.2 Core Regressions Verification
- **Credential storage read failure -> sanitized Model Accounts ERROR**: **PASS** (`authorization status reports a safe ERROR state when credential storage cannot be read`).
- **Failed legacy grant deletion -> generic internal RPC failure**: **PASS** (`legacy logout reports an internal failure when deleting the grant fails`).
- **Credential/backend secret text does not cross RPC boundary**: **PASS** (`authorization status exposes credential kind but never credential material`, `authorization rpc converts host failures to generic errors`).

---

## 4. Full Workspace Gates

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm test` | `0` | **PASS** | All workspace packages executed and passed (Core: 178, Project Memory: 57, Codex: 31, Suite: 12, etc.) |
| `pnpm check` | `0` | **PASS** | Clean across all workspace packages |
| `pnpm build` | `0` | **PASS** | Clean build for all 6 packages |

---

## 5. Full Local Repository Gate (`pnpm verify:local`)

- **Command**: `pnpm verify:local`
- **Exit Code**: `0`
- **Result**: **PASS**
  - `verify:release-family`: **PASS** (`release-family-ok 6 packages @ 0.1.0-rc.3`)
  - `verify:package-contracts`: **PASS** (`package-contracts-ok 6 publishable packages`)
  - `test:orchestrator`: **PASS** (`orchestrator validated: 28 unique rows`)
  - `build`: **PASS** (all packages built)
  - `check`: **PASS** (typechecks clean across all packages)
  - `test`: **PASS** (all test suites clean)
  - `pack:local`: **PASS** (packed all 6 package tarballs into `.artifacts/packs`)

---

## 6. Disposable DSH 0.1.2-alpha.1 Compatibility Gate

### 6.1 Upstream Verification Environment
- Upstream repository: `deepseek-ai/deepseek-harness` in disposable directory `/tmp/dsh-upstream-alpha1`
- Verified tag: `dsh-v0.1.2-alpha.1`
- Verified commit: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- All upstream packages built cleanly (`pnpm build`).

### 6.2 Alpha.1 Seam Checks Summary
| Seam / Contract | Target | Result | Details |
|---|---|---|---|
| Upstream Tag & Commit match | Upstream | **PASS** | `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc` |
| Native 2-argument `rpc.handle(channel, handler)` | Core | **PASS** | Registered Connection RPC channels without legacy 3rd argument |
| `/authorization` status endpoint | Core | **PASS** | Projects safe DTOs against alpha.1 credential model |
| Credential store read failure containment | Core | **PASS** | Surfaces safe `ERROR` status (`Authorization state is unavailable.`) |
| Failed legacy grant delete rejection | Core | **PASS** | Returns generic internal error without nominal logout success |
| Secret text boundary protection | Core | **PASS** | No tokens, paths, or stack traces leak across RPC boundary |
| Package imports & runtime boot | Project Memory | **PASS** | Cordis `Context` plugin mount registers `memory_read`, `memory_write`, `memory_edit` |
| **`memory_write` against alpha.1** | Project Memory | **PASS** | Real execution returns valid `WriteTopicMemoryResult` (`created: true`, `path`, `topic`) and commits Memory map |
| **`memory_edit` against alpha.1** | Project Memory | **PASS** | Real execution returns valid `EditTopicMemoryResult` (`topic`, `path`, `bytesWritten`) and updates topic content |
| `memory_read` against alpha.1 | Project Memory | **PASS** | Correctly reads bootstrap and named topics |
| Lock contention AbortSignal cancellation | Project Memory | **PASS** | Aborted signal cancels lock wait without executing mutation |
| Mandatory settlement after cancellation | Project Memory | **PASS** | `forSettlement()` scope successfully restores durable participant state |
| Descriptor-chain Linux safety | Project Memory | **PASS** | Swapped parent directory caught and mutation applied to pinned descriptor |
| Intermediate `.dsh` symlink replacement | Project Memory | **PASS** | Swapped `.dsh` symlink fails closed without writing to external sentinel |
| Pending / Committed WAL recovery | Project Memory | **PASS** | Dead-owner pending journal restored; committed journal preserved |
| Recovery owner transfer fail-closed | Project Memory | **PASS** | Dead->live PID mutation during recovery claim fails closed |
| Lock / WAL leakage | Project Memory | **PASS** | 0 lingering `.lock` or journal files after operations |

---

## 7. Working Tree Integrity Check

Post-verification integrity check executed on main repository checkout:
```bash
git status --short
git diff --exit-code -- \
  packages/core \
  packages/project-memory \
  package.json \
  pnpm-lock.yaml \
  docs/README.md \
  docs/HANDOFF.md \
  docs/ROADMAP.md \
  docs/ARCHITECTURE.md \
  docs/verification/README.md
```
- **Exit Code**: `0`
- **Result**: **PASS** (Zero implementation or documentation drift).

---

## 8. Skips & Limitations

- **Windows**: **NOT TESTED** (POSIX descriptor-chain guarantees tested on Linux; Windows remains deferred).
- **GitHub Actions / Hosted CI**: **NOT USED** (local verification only).

---

## 9. Final Verdict

```text
Foundation remediation validation PASS.
Core and Project Memory are eligible for re-freeze.
```
