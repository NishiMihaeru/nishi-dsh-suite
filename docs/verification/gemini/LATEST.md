# Foundation Remediation Validation Report: Core & Project Memory (Follow-up)

- **Result**: `PASS`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested Implementation HEAD**: `7cd4d5b17625f9b3a21b741555df6597fd9cb889`
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

Independent follow-up validation of the Foundation Remediation for **Core** (`nishi-dsh-core`) and **Project Memory** (`nishi-dsh-project-memory`) on branch `feat/core-provider-plugins-rc3` (HEAD `7cd4d5b17625f9b3a21b741555df6597fd9cb889`) resulted in **PASS**.

All three defects identified in the first Gemini validation run were cleanly and robustly resolved without regressions or architectural overcomplexity:
1. **Lock acquisition collision race resolved**: `isLockRenameContention` authoritatively recognizes destination collision errno values (`EEXIST`, `ENOTEMPTY`, `ENOTDIR`, `EISDIR`) from the publishing `rename()` without re-statting the lock path, completely preventing spurious exceptions when a lock is released between `rename()` and inspection.
2. **Concurrent journal unlink handling resolved**: `readRegularFile` handles `ENOENT` during post-`open()` identity `lstat()` by returning `null`, reflecting namespace absence without surfacing unhandled errors during unlocked recovery preflights, while non-file or inode-swap replacements still fail closed.
3. **Legacy journal owner transfer assertion resolved**: `sameTransactionGeneration` for legacy journals without `transactionId` is defined over immutable transaction snapshots (`topic`, `topicBefore`, `memoryBefore`), allowing owner PID/identity checks to reach explicit owner validation and fail closed with the expected owner-change error.

---

## 1. Initial State & Setup Commands

| Command | Exit Code | Output / Detail |
|---|---|---|
| `git switch feat/core-provider-plugins-rc3` | `0` | Switched to / already on branch `feat/core-provider-plugins-rc3` |
| `git pull --ff-only` | `0` | Fast-forward to `7cd4d5b17625f9b3a21b741555df6597fd9cb889` |
| `git rev-parse HEAD` | `0` | `7cd4d5b17625f9b3a21b741555df6597fd9cb889` |
| `git status --short` | `0` | Working tree clean |
| `node --version` | `0` | `v24.19.0` |
| `pnpm --version` | `0` | `11.21.0` |
| `pnpm install --frozen-lockfile` | `0` | `Already up to date in 394ms` |

---

## 2. Core Focused Gates

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 182 tests executed: **182 passed**, 0 failed |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean (0 errors) |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` built all ESM/CJS bundles and declaration files |

### Core Remediation Verification
- **Legacy logout TOCTOU**: **PASS**. `LEGACY_LOGOUT_PROVIDER_IDS` is empty; logout RPC immediately rejects requests with `bad-request`; zero calls made to `describeRecord` or `deleteRecord`; browser `ModelsSignInCard.tsx` renders informational notice and disables destructive Sign Out for legacy grants.
- **Usage invalidation**: **PASS**. `UsageLimitsService.invalidate(providerId)` immediately deletes cache and creates an invalidation token symbol; `getCachedSnapshot` and `getCachedSnapshots` omit invalidated data; pre-invalidation in-flight refresh cannot republish into cache; browser `loadCached()` clears prior `FRESH` entries when omitted from host list, allowing `ensureFresh()` to refresh.

---

## 3. Project Memory Focused Gates

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `0` | **PASS** | 64 tests executed: **64 passed**, 0 failed |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean (0 errors) |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | **PASS** | `tsc -p tsconfig.json` clean (declarations + JS emitted) |

---

## 4. Full Workspace & Local Verification Gates

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm test` | `0` | **PASS** | All workspace packages passed (Core: 182, Project Memory: 64, Codex: 31, Suite: 12, Antigravity: 7, Claude: 0) |
| `pnpm check` | `0` | **PASS** | Clean across all 6 packages |
| `pnpm build` | `0` | **PASS** | Clean build across all 6 packages |
| `pnpm verify:local` | `0` | **PASS** | All stages succeeded: `verify:release-family`, `verify:package-contracts`, `test:orchestrator`, `build`, `check`, `test`, `pack:local` |

---

## 5. Specific Follow-up Fix Verification & Repeated Concurrency Testing

The three previously failing/flaky suites were executed in a repeated stress harness:
```bash
for i in {1..20}; do
  pnpm --filter nishi-dsh-project-memory exec tsx --test \
    test/atomic-write.test.ts \
    test/compound-transaction.test.ts \
    test/transaction-recovery.test.ts
done
```
- **Total Iterations**: 20 consecutive iterations (460 total test assertions across multi-process workloads)
- **Failed Iterations**: 0
- **Passed Iterations**: 20 (**PASS**)
- **Results**:
  - `atomic-write.test.ts`: 0 instances of unhandled `ENOTEMPTY` / `ENOTDIR` under heavy contention.
  - `compound-transaction.test.ts`: 0 instances of `Canonical target ... changed while it was being opened`.
  - `transaction-recovery.test.ts`: Exact regex match on `/recovery journal owner changed to a live process before claim/`.

---

## 6. Disposable DSH 0.1.2-alpha.1 Compatibility Gate

- **Upstream Repository**: `deepseek-ai/deepseek-harness` in disposable directory `/tmp/dsh-upstream-alpha1`
- **Upstream Tag**: `dsh-v0.1.2-alpha.1`
- **Upstream Commit**: `cd5ef8148158c3a752a658978873241fdf8e2bbc` (verified by `git rev-parse HEAD`)
- **Upstream Build**: `pnpm build` clean (exit code `0`)

### Runtime Probe Execution against Alpha.1 Packages:
1. **Project Memory Tools**:
   - `memory_write` with topic + Memory map update: **PASS** (returned valid `WriteTopicMemoryResult`)
   - `memory_read` for named topic and bootstrap `memory`: **PASS**
   - `memory_edit` deterministic replacement: **PASS** (returned valid `EditTopicMemoryResult`)
   - `ToolRunContext.signal` cancellation: **PASS** (aborted signal rejected before mutation)
   - Unlocked pending recovery under alpha.1: **PASS** (restored exact pre-crash state)
2. **Core Connection & RPC**:
   - Native two-argument `connection.rpc.handle(channel, handler)`: **PASS**
   - `/authorization` `get-provider-status` for unconfigured / legacy grant: **PASS**
   - Legacy logout rejection (fail-closed, no credential deletion): **PASS**
   - `UsageLimitsService` invalidation & cache drop: **PASS**

---

## 7. Audit of the 7 Specific Remediation Targets

| Finding | Target Area | Implementation Status | Validation Status |
|---|---|---|---|
| 1 | PM: Journal generation race | Random `transactionId` in journal; expected generation check in cleanup; cleanup under participant locks | **PASS** |
| 2 | PM: Stale lock replacement race | Directory lock with token-based owner markers, authoritative collision detection, safe removal checks | **PASS** |
| 3 | PM: PID reuse | Linux `/proc/<pid>/stat` (field 22 start time) and macOS `ps lstart`; fallback conservative | **PASS** |
| 4 | PM: Bounded bootstrap ingestion | Prefix bounds (`prefixBytes: 25KiB+4`) applied before materialization | **PASS** |
| 5 | PM: WAL permissions | Explicit `{ mode: 0o600 }` on pending, committed, and recovery claim | **PASS** on POSIX |
| 6 | Core: Legacy logout TOCTOU | Destructive legacy logout disabled/fail-closed; no describe-then-delete calls | **PASS** |
| 7 | Core: Usage invalidation | `invalidate()` clears cache & advances token; pre-invalidation refresh cannot republish; browser clears prior `FRESH` snapshot | **PASS** |

---

## 8. Lock & WAL Residue Verification

- Post-test filesystem inspections verified:
  - **Zero lingering `*.lock` directories or files** in `.dsh/`, `.dsh/memory/`, or test temporary workspaces.
  - **Zero lingering `project-memory-transaction.json` files** after normal commits or completed recovery runs.
  - Bidirectional interoperability with `@deepseek-ai/dsh-atomic-write` verified.

---

## 9. Independent Code Review Findings

- **Lock Collision Logic (`filesystem.ts`)**: `isLockRenameContention` is scoped exclusively to the `rename(tempLockPath, lockPath)` publication step. Preparing the temporary directory and marker remains strictly fail-closed.
- **Identity Re-check on Open (`filesystem.ts`)**: Handling `ENOENT` as `null` in `readRegularFile` correctly models concurrent unlinks without leaking unlinked descriptor data or permitting inode swaps (since any non-matching inode/symlink still throws).
- **Transaction Generation & Ownership Separation (`transaction.ts`)**: Clean separation between immutable transaction generation data and mutable ownership state.
- **ABA Safety**: Random `transactionId` and random lock marker acquisition tokens prevent ABA recycling across process restarts.
- **Lock Ordering**: MEMORY.md lock is acquired prior to topic lock across all compound transactions, preventing lock-order inversion and deadlocks.

---

## 10. Documentation Consistency

- Canonical documentation verified: `docs/README.md`, `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/RELEASE.md`, `packages/core/README.md`, and `packages/project-memory/README.md`.
- No drift in tracked implementations, manifests, or canonical contracts.

---

## 11. Skips & Limitations

- **Windows**: **NOT TESTED** (POSIX descriptor-chain guarantees tested on Linux; Windows remains deferred).
- **Hosted CI / GitHub Actions**: **NOT USED** (100% local execution).

---

## 12. Final Validation Verdict

```text
Foundation remediation validation PASS.
Core and Project Memory are eligible for re-freeze.
```

