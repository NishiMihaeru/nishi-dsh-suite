# Foundation Remediation Validation Report: Core & Project Memory

- **Result**: `FAIL`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested Implementation HEAD**: `70a73869d4fa63f541906ca8b2669f2af089f46f`
- **Working Tree State Before Validation**: Clean (0 modified / 0 untracked files)
- **Working Tree State After Validation**: Clean (only `docs/verification/gemini/LATEST.md` modified)
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - OS: Linux (CachyOS / kernel 6.18, x86_64)
  - Hosted CI / GitHub Actions: **NOT USED** (local execution only)
  - Windows: **NOT TESTED**
- **DSH Baselines**:
  - Local installed workspace baseline: `0.1.1-rc.2`
  - Upstream official compatibility target: `deepseek-ai/deepseek-harness` at tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` (verified via git command)

---

## Executive Summary

Independent validation of the Foundation Remediation for **Core** (`nishi-dsh-core`) and **Project Memory** (`nishi-dsh-project-memory`) on branch `feat/core-provider-plugins-rc3` (HEAD `70a73869d4fa63f541906ca8b2669f2af089f46f`) resulted in **FAIL**.

While all 4 Core audit remediation items and several Project Memory fixes (such as bounded bootstrap reading, 0600 journal permissions, and Linux process-birth identity) were implemented correctly, **concrete new race condition defects and a test assertion regression were discovered in Project Memory**:

1. **`withWriterLock` Lock Contention Race (HIGH)**:
   In `packages/project-memory/src/filesystem.ts`, when `rename(tempLockPath, lockPath)` fails due to an existing lock (`ENOTEMPTY` or `ENOTDIR`), `isLockContention` calls `pathExists(lockPath)`. If the holding process releases the lock between the `rename` syscall and the `lstat` call, `pathExists` returns `false`, causing `withWriterLock` to rethrow `ENOTEMPTY` or `ENOTDIR` and crash the caller instead of continuing the acquisition retry loop.
2. **`readRegularFile` Concurrent Deletion Throw (HIGH / MEDIUM)**:
   In `packages/project-memory/src/filesystem.ts`, when `readRegularFile` opens a file and the subsequent `lstat(targetPath)` identity re-check receives `ENOENT` (e.g. when reading `project-memory-transaction.json` during an un-locked recovery check while the committing process unlinks the journal), it throws an uncaught `Error: Canonical target at "..." changed while it was being opened` rather than returning `null` or handling the expected concurrent removal.
3. **`sameTransactionGeneration` Legacy Journal Ownership Transfer Assertion (MEDIUM)**:
   In `packages/project-memory/src/transaction.ts`, for legacy journals without `transactionId`, `sameTransactionGeneration` compares `left.ownerPid === right.ownerPid`. When a dead owner's PID is changed to a live PID before claim, line 404 throws `Project memory recovery journal changed while recovery was starting` before reaching the explicit dead-to-live ownership check on lines 407–412, causing `test/transaction-recovery.test.ts` to fail.

---

## 1. Initial State & Setup Commands

| Command | Exit Code | Output / Detail |
|---|---|---|
| `git switch feat/core-provider-plugins-rc3` | `0` | Switched to / already on branch `feat/core-provider-plugins-rc3` |
| `git pull --ff-only` | `0` | Fast-forward to `70a73869d4fa63f541906ca8b2669f2af089f46f` |
| `git rev-parse HEAD` | `0` | `70a73869d4fa63f541906ca8b2669f2af089f46f` |
| `git status --short` | `0` | Working tree clean |
| `node --version` | `0` | `v24.19.0` |
| `pnpm --version` | `0` | `11.21.0` |
| `pnpm install --frozen-lockfile` | `0` | `Already up to date in 392ms` |

---

## 2. Core Focused Gates

### 2.1 Summary of Core Commands

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 182 tests executed: **182 passed**, 0 failed |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean (0 errors) |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` built all ESM/CJS bundles and declarations |

### 2.2 Core Remediation Verification

- **Legacy logout TOCTOU**: **PASS**. `LEGACY_LOGOUT_PROVIDER_IDS` is empty; logout RPC immediately rejects requests with `bad-request`; zero calls made to `describeRecord` or `deleteRecord`; browser `ModelsSignInCard.tsx` renders informational notice and disables destructive Sign Out for legacy grants.
- **Usage invalidation**: **PASS**. `UsageLimitsService.invalidate(providerId)` immediately deletes cache and creates an invalidation token symbol; `getCachedSnapshot` and `getCachedSnapshots` omit invalidated data; pre-invalidation in-flight refresh cannot republish into cache; browser `loadCached()` clears prior `FRESH` entries when omitted from host list, allowing `ensureFresh()` to refresh.

---

## 3. Project Memory Focused Gates

### 3.1 Summary of Project Memory Commands

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `1` | **FAIL** | 64 tests executed: **62 passed**, **2 failed** (in full workspace concurrency up to 3 failed) |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean (0 errors) |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | **PASS** | `tsc -p tsconfig.json` clean (declarations + JS emitted) |

---

## 4. Full Workspace & Local Verification Gates

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm test` | `1` | **FAIL** | Failed due to `nishi-dsh-project-memory` test failures |
| `pnpm check` | `0` | **PASS** | Clean across all 6 packages |
| `pnpm build` | `0` | **PASS** | Clean build across all 6 packages |
| `pnpm verify:local` | `1` | **FAIL** | Failed during `test` phase (due to `nishi-dsh-project-memory`) |

---

## 5. Detailed Breakdown of Failures & Race Interleavings

### Failure 1: Writer Lock Contention Race (`withWriterLock` / `isLockContention`)
- **Severity**: HIGH
- **Files**: `packages/project-memory/src/filesystem.ts` (lines 294–300, 680–708)
- **Observed Failures in Suite**:
  - `test/atomic-write.test.ts`: `independent topic exact edits from separate processes re-read under one writer lock` (`Error: ENOTEMPTY: directory not empty, rename ... -> ...`)
  - `test/atomic-write.test.ts`: `MEMORY.md map update and exact edit serialize across processes and preserve both changes` (`Error: ENOTDIR: not a directory, rename ... -> ...`)
  - `test/atomic-write.test.ts`: `whole-file topic writers honor the same lock used by topic RMW edits` (`Error: ENOTDIR: not a directory, rename ... -> ...`)

#### Technical Cause & Interleaving
1. Process A holds the lock directory `<target>.lock` (or a legacy regular file lock created by `@deepseek-ai/dsh-atomic-write`).
2. Process B attempts to acquire the lock: it creates a temporary populated directory `<target>.lock.<token>.tmp` and calls `rename(tempLockPath, lockPath)`.
3. The kernel returns `ENOTEMPTY` (if destination is an existing non-empty directory) or `ENOTDIR` (if destination is an existing regular file).
4. In `catch (error)`, Process B evaluates:
   ```ts
   if (!await isLockContention(error, lockPath)) throw error
   ```
   `isLockContention` checks error codes, which match, and then calls `await pathExists(lockPath)` (`await lstat(lockPath)`).
5. **The Race Window**: Process A finishes its critical section and removes `lockPath` immediately after step 2.
6. `pathExists(lockPath)` executes `lstat(lockPath)` and receives `ENOENT`.
7. `pathExists` returns `false`, causing `isLockContention` to return `false`.
8. Process B throws `ENOTEMPTY` / `ENOTDIR`, crashing the worker/process rather than retrying lock acquisition in the `for (;;)` loop.

---

### Failure 2: `readRegularFile` Throws Uncaught Exception on Concurrent File Deletion
- **Severity**: HIGH / MEDIUM
- **Files**: `packages/project-memory/src/filesystem.ts` (lines 557–567), `packages/project-memory/src/transaction.ts` (lines 144–167, 380–388)
- **Observed Failure in Suite**:
  - `test/compound-transaction.test.ts`: `concurrent compound exact edits retain both independent changes and one map entry` (`Error: Canonical target at ".../.dsh/local/project-memory-transaction.json" changed while it was being opened`)

#### Technical Cause & Interleaving
1. Process A is executing a compound transaction and has written `.dsh/local/project-memory-transaction.json`.
2. Process B starts `editTopicMemoryWithMap`, which calls `recoverPendingProjectMemoryTransaction` -> `readPendingTransaction` (un-locked preflight check to see if a crashed transaction exists).
3. Process B opens `.dsh/local/project-memory-transaction.json` (`await open(targetPath)`).
4. Process A completes its transaction and unlinks `project-memory-transaction.json` (`removeRegularFile`).
5. Process B performs the identity validation `visible = await lstat(targetPath)`.
6. Because the file was just removed by Process A, `lstat` throws `ENOENT`.
7. Line 560 catches `ENOENT` and explicitly throws:
   ```ts
   throw new Error(`Canonical target at "${targetFilePath}" changed while it was being opened`)
   ```
8. Because `readPendingTransaction` does not catch this, the error propagates and aborts Process B's compound edit operation.

---

### Failure 3: `sameTransactionGeneration` Legacy Journal Owner Transfer Error Mismatch
- **Severity**: MEDIUM
- **Files**: `packages/project-memory/src/transaction.ts` (lines 126–138, 404–412), `packages/project-memory/test/transaction-recovery.test.ts` (lines 153–185)
- **Observed Failure in Suite**:
  - `test/transaction-recovery.test.ts`: `recovery fails closed if a dead-owner journal is transferred to a live owner before claim`

#### Technical Cause & Interleaving
1. `installAbandonedPending` creates a legacy journal without `transactionId` where `ownerPid = deadPid` (2000000000).
2. During recovery lock wait, the test simulates an external process rewriting `ownerPid = process.pid` (a live process).
3. In `recoverPendingProjectMemoryTransaction`:
   ```ts
   if (!sameTransactionGeneration(current, initial) || current.phase !== initial.phase) {
     throw new Error('Project memory recovery journal changed while recovery was starting')
   }
   ```
4. For legacy journals where `transactionId === undefined`, `sameTransactionGeneration` evaluates `left.ownerPid === right.ownerPid`, which returns `false` because `deadPid !== process.pid`.
5. Recovery throws `'Project memory recovery journal changed while recovery was starting'` instead of proceeding to lines 407–412 (which checks `processOwnerIsAlive` and throws `'Project memory recovery journal owner changed to a live process before claim'`).
6. The test assertion `assert.rejects(recovery, /recovery journal owner changed to a live process before claim/)` fails.

---

## 6. Disposable DSH 0.1.2-alpha.1 Compatibility Gate

- **Upstream Repository**: `deepseek-ai/deepseek-harness` in disposable `/tmp/dsh-upstream-alpha1`
- **Upstream Tag**: `dsh-v0.1.2-alpha.1`
- **Upstream Commit**: `cd5ef8148158c3a752a658978873241fdf8e2bbc` (verified by `git rev-parse HEAD`)
- **Upstream Build**: `pnpm build` clean (exit code `0`)

### Runtime Probe Results against Alpha.1 Packages:
1. **Project Memory Tools**:
   - `memory_write` with topic + Memory map update: **PASS** (returned valid `WriteTopicMemoryResult`)
   - `memory_read` for named topic and bootstrap `memory`: **PASS**
   - `memory_edit` deterministic replacement: **PASS** (returned valid `EditTopicMemoryResult`)
   - `ToolRunContext.signal` cancellation: **PASS** (aborted signal rejected before mutation)
2. **Core Connection & RPC**:
   - Native two-argument `connection.rpc.handle(channel, handler)`: **PASS**
   - `/authorization` `get-provider-status` for unconfigured / legacy grant: **PASS**
   - Legacy logout rejection (fail-closed, no credential deletion): **PASS**
   - `UsageLimitsService` invalidation & cache drop: **PASS**

---

## 7. Audit of the 7 Specific Remediation Targets

| Finding | Target Area | Implementation Status | Validation Status |
|---|---|---|---|
| 1 | PM: Journal generation race | Random `transactionId` in journal; expected generation check in cleanup; cleanup under participant locks | PASS (design verified; generation cleanup isolated) |
| 2 | PM: Stale lock replacement race | Populated directory `<target>.lock` with PID, token, processIdentity; conditional removal | **FAIL** due to `isLockContention` race in `withWriterLock` |
| 3 | PM: PID reuse | Linux `/proc/<pid>/stat` (field 22 start time) and macOS `ps lstart`; fallback conservative | PASS (parsing tested on Linux with parens/spaces) |
| 4 | PM: Bounded bootstrap ingestion | Prefix bounds (`prefixBytes: 25KiB+4`) applied before materialization | PASS (large file sparse fixture tested) |
| 5 | PM: WAL permissions | Explicit `{ mode: 0o600 }` on pending, committed, and recovery claim | PASS on POSIX (`0o600` verified) |
| 6 | Core: Legacy logout TOCTOU | Destructive legacy logout disabled/fail-closed; no describe-then-delete calls | PASS |
| 7 | Core: Usage invalidation | `invalidate()` clears cache & advances token; pre-invalidation refresh cannot republish; browser clears prior `FRESH` snapshot | PASS |

---

## 8. Documentation Consistency

- Checked `docs/README.md`, `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/RELEASE.md`, `packages/core/README.md`, and `packages/project-memory/README.md`.
- All canonical documentation consistently describes Foundation status as:
  ```text
  REOPENED / PENDING VERIFICATION
  ```
- No premature `FROZEN` claim exists in canonical docs.

---

## 9. Skips & Limitations

- **Windows**: **NOT TESTED** (Windows mode bits and birth identity skipped on POSIX; Windows remains deferred).
- **Hosted CI / GitHub Actions**: **NOT USED** (100% local execution).

---

## 10. Final Validation Verdict

```text
Foundation remediation validation FAIL.
Foundation status remains: REOPENED / PENDING VERIFICATION.
```

