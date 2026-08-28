# Foundation Remediation Validation Report: Core & Project Memory

- **Result**: `FAIL`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested Implementation HEAD**: `f3ee493bbea95b3ae7cc34c2c812a4dc23d6118f`
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

Validation of the Foundation Remediation for **Core** (`nishi-dsh-core`) and **Project Memory** (`nishi-dsh-project-memory`) on implementation HEAD `f3ee493bbea95b3ae7cc34c2c812a4dc23d6118f` resulted in **FAIL**.

- **Core focused gates**: **PASS** (178/178 tests passed, TypeScript check clean, tsdown build clean).
- **Project Memory focused gates**: **FAIL**
  1. `pnpm --filter nishi-dsh-project-memory test` exited with code `1` (56/57 passed, 1 failed: `test/filesystem-race.test.ts`).
  2. `pnpm --filter nishi-dsh-project-memory check` exited with code `2` (TypeScript compilation error `TS2322` in `src/topics.ts:325:3` and `src/topics.ts:395:3`).
  3. `pnpm --filter nishi-dsh-project-memory build` exited with code `2` (TypeScript compilation error `TS2322` in `src/topics.ts:325:3` and `src/topics.ts:395:3`).
- **Full workspace gates**: **FAIL** (blocked by Project Memory test, check, and build failures).
- **Local repository verification (`pnpm verify:local`)**: **FAIL** (exited with code `2` during `pnpm build`).
- **Disposable Upstream DSH 0.1.2-alpha.1 compatibility gate**: Core compatibility passed; Project Memory runtime probes failed due to `withExistingProjectDshScope` returning `undefined` and `filesystem-race.test.ts` race expectation mismatch.
- **Working Tree Integrity**: **PASS** (0 bytes drift in tracked implementation, manifests, or canonical documentation).

Per validation instructions, no source or configuration fixes were attempted.

---

## 1. Initial State & Frozen Install Gate

### 1.1 Initial Environment Checks
| Command | Exit Code | Output / Detail |
|---|---|---|
| `git switch feat/core-provider-plugins-rc3` | `0` | Switched / already on branch |
| `git pull --ff-only` | `0` | Fast-forwarded to `f3ee493bbea95b3ae7cc34c2c812a4dc23d6118f` |
| `git rev-parse HEAD` | `0` | `f3ee493bbea95b3ae7cc34c2c812a4dc23d6118f` (exact match) |
| `git status --short` | `0` | Working tree clean |
| `node --version` | `0` | `v24.19.0` |
| `pnpm --version` | `0` | `11.21.0` |

### 1.2 Frozen Install Gate
- Command: `pnpm install --frozen-lockfile`
- Exit code: `0`
- Result: **PASS** (`Already up to date in 371ms`).
- Post-install `git status --short`: clean (0 modified files).

---

## 2. Core Focused Gates

### 2.1 Summary of Core Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 178 tests executed: **178 passed**, 0 failed |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | TypeScript typecheck clean |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` build emitted all ESM/CJS bundles and declaration files |

### 2.2 Core Regressions Verification
- **Credential storage read failure -> sanitized Model Accounts ERROR**: **PASS** (`authorization status reports a safe ERROR state when credential storage cannot be read`).
- **Failed legacy grant deletion -> generic internal RPC failure**: **PASS** (`legacy logout reports an internal failure when deleting the grant fails`).
- **Credential/backend secret text does not cross RPC boundary**: **PASS** (`authorization status exposes credential kind but never credential material`, `authorization rpc converts host failures to generic errors`).

---

## 3. Project Memory Focused Gates

### 3.1 Summary of Project Memory Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `1` | **FAIL** | 57 tests executed: **56 passed**, 1 failed |
| `pnpm --filter nishi-dsh-project-memory check` | `2` | **FAIL** | TypeScript `TS2322` errors in `src/topics.ts` |
| `pnpm --filter nishi-dsh-project-memory build` | `2` | **FAIL** | Compilation blocked by TypeScript errors |

### 3.2 Detailed Failure Analysis

#### A. Unit Test Failure: `test/filesystem-race.test.ts`
- **Failing test**: `concurrent safe removals converge without surfacing ENOENT races`
- **Failure Output**:
  ```text
  ✖ concurrent safe removals converge without surfacing ENOENT races (33.644108ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

    32 !== 1

        at TestContext.<anonymous> (packages/project-memory/test/filesystem-race.test.ts:22:12)
  ```
- **Root Cause**: `Promise.all(Array.from({ length: 32 }, () => removeSafeRegularFile(projectRoot, target)))` launched 32 concurrent removal operations. Each call executes `assertRegularTargetIfPresent` and `rm(targetPath)` independently. Under concurrent execution, `results.filter(Boolean).length` resolved to `32` rather than `1`.

#### B. Typecheck / Build Failure: `src/topics.ts`
- **Failure Output**:
  ```text
  src/topics.ts:325:3 - error TS2322: Type 'WriteTopicMemoryResult | undefined' is not assignable to type 'WriteTopicMemoryResult'.
    Type 'undefined' is not assignable to type 'WriteTopicMemoryResult'.

  325   return result
        ~~~~~~

  src/topics.ts:395:3 - error TS2322: Type 'EditTopicMemoryResult | undefined' is not assignable to type 'EditTopicMemoryResult'.
    Type 'undefined' is not assignable to type 'EditTopicMemoryResult'.

  395   return result
        ~~~~~~

  Found 2 errors in the same file, starting at: src/topics.ts:325
  ```
- **Root Cause**: `writeTopicMemoryWithMap` (line 325) and `editTopicMemoryWithMap` (line 395) wrap execution in `withExistingProjectDshScope(...)`, which has return type `Promise<T | undefined>`. Since the function signatures require `Promise<WriteTopicMemoryResult>` and `Promise<EditTopicMemoryResult>`, TypeScript rejects the potential `undefined` return.

### 3.3 Regressions Status in Project Memory
- **Static symlink / canonical path safety**: PASS (`bootstrap write refuses a pre-existing symlink target`, `topic write refuses a pre-existing symlink target`, `K/L/N/O symlink security`).
- **Symlinked explicit workspace root**: PASS (`direct bootstrap creation keeps a symlinked explicit project root usable`, `direct topic write keeps a symlinked explicit project root usable`, `initialization keeps a symlinked explicit project root usable`).
- **Replacement locked parent directory during RMW**: PASS (`writer scope never redirects a locked RMW into a replacement parent directory`).
- **Replacement intermediate `.dsh` with external symlink without writing to external sentinel**: PASS (`child directory scope never follows a swapped canonical parent symlink`).
- **AbortSignal cancellation while waiting for writer lock**: PASS (`writer lock cancellation rejects before a contended lock is released and never runs the mutation`).
- **Mandatory settlement after cancellation following a durable participant write**: PASS (`mandatory settlement on the same scope can restore a durable participant after caller cancellation`).
- **Compound MEMORY.md + topic serialization**: PASS (`separate processes serialize compound writes through MEMORY.md and preserve every topic/map pair`).
- **Pending transaction rollback**: PASS (`pending recovery restores exact pre-transaction state after process death between participant commits`).
- **Committed transaction preserve-and-clean recovery**: PASS (`committed recovery preserves both new participants and only cleans dead locks and journal`).
- **Abandoned pending transaction with still-live PID after MEMORY.md lock barrier**: PASS (`a pending journal owned by this live process is recoverable once the Memory map lock is free`, `a new Memory-map transaction settles abandoned pending state after acquiring the map lock`).
- **Recovery owner transfer to another live process -> fail closed**: PASS (`recovery fails closed if a dead-owner journal is transferred to a live owner before claim`).
- **No stale lock leakage**: PASS (all recovery and stress tests verify clean lock and journal removal).

---

## 4. Full Workspace & Repository Local Verification Gates

### 4.1 Full Workspace Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm test` | `1` | **FAIL** | Failed on `packages/project-memory` (`filesystem-race.test.ts`) |
| `pnpm check` | `2` | **FAIL** | Failed on `packages/project-memory` (`src/topics.ts` TS2322) |
| `pnpm build` | `2` | **FAIL** | Failed on `packages/project-memory` (`src/topics.ts` TS2322) |

### 4.2 Local Repository Verification (`pnpm verify:local`)
- Command: `pnpm verify:local`
- Exit Code: `2` (**FAIL**)
  - `verify:release-family`: **PASS** (`release-family-ok 6 packages @ 0.1.0-rc.3`)
  - `verify:package-contracts`: **PASS** (`package-contracts-ok 6 publishable packages`)
  - `test:orchestrator`: **PASS** (`orchestrator validated: 28 unique rows`)
  - `build`: **FAIL** (`tsc -p tsconfig.json` exited with code 2 on `packages/project-memory`)
  - `check`: Blocked by build failure
  - `test`: Blocked by build failure
  - `pack:local`: Blocked by build failure

---

## 5. DSH 0.1.2-alpha.1 Compatibility Gate

### 5.1 Upstream Verification Environment
- Cloned upstream repository: `deepseek-ai/deepseek-harness` to disposable directory `/tmp/dsh-upstream-alpha1`.
- Verified tag: `dsh-v0.1.2-alpha.1`
- Verified commit: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- Verified all upstream packages compiled via `pnpm build` (`build:lib:host` and `build:lib:client`).

### 5.2 Alpha.1 Seam Checks Summary
| Seam / Contract | Target | Result | Details |
|---|---|---|---|
| Native 2-argument `rpc.handle(channel, handler)` | Core | **PASS** | Registered `/authorization` and `/usage-limits` without legacy `trusted-host` options |
| `/authorization` status endpoint | Core | **PASS** | Projects safe DTOs against alpha.1 `credentialKey('llm-pi-ai', ...)` |
| Credential store read failure containment | Core | **PASS** | Surfaces safe `ERROR` status (`Authorization state is unavailable.`) |
| Failed legacy grant delete rejection | Core | **PASS** | Returns generic internal error without nominal logout success |
| Secret text boundary protection | Core | **PASS** | No bearer tokens or storage paths cross Connection RPC boundary |
| Package imports & runtime boot | Project Memory | **PASS** | Cordis `Context` plugin mount operates cleanly on alpha.1 |
| Lock contention AbortSignal cancellation | Project Memory | **PASS** | Aborting while waiting on lock throws without executing mutation |
| Mandatory settlement after cancellation | Project Memory | **PASS** | `forSettlement()` scope successfully restores durable participant |
| Descriptor-chain Linux safety | Project Memory | **PASS** | Locked parent directory swap rejected |
| Intermediate `.dsh` symlink replacement | Project Memory | **PASS** | Swapped `.dsh` symlink fails closed without writing to external sentinel |
| Pending / Committed WAL recovery | Project Memory | **PASS** | Dead-owner pending journal restored; committed journal preserved |
| Recovery owner transfer fail-closed | Project Memory | **PASS** | Dead->live PID mutation during recovery claims fails closed |
| Lock / WAL leakage | Project Memory | **PASS** | 0 lingering `.lock` or journal files after settlements |
| `memory_write` / `memory_edit` against alpha.1 | Project Memory | **FAIL** | `editTopicMemoryWithMap` returns `undefined` due to scope return typing |

---

## 6. Working Tree Integrity Check

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

## 7. First Failing Gate & Final Verdict

- **First Failing Gate**: Gate 3 (`pnpm --filter nishi-dsh-project-memory test` / `check` / `build`).
- **Primary Failure Modes**:
  1. `packages/project-memory/test/filesystem-race.test.ts:22`: `AssertionError: 32 !== 1` during concurrent removal stress.
  2. `packages/project-memory/src/topics.ts:325, 395`: TypeScript compilation error `TS2322` (`Type '... | undefined' is not assignable to type '...'`).

```text
================================================================================
Foundation Remediation Validation: FAIL
Core: PASS (Eligible for freeze)
Project Memory: FAIL (Compilation TS2322 and test assertion failures)
================================================================================
```
