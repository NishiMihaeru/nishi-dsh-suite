# Local Validation Report: Project Memory Compound Named-Topic + Memory-Map Transaction

- **Result**: `FAIL`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested implementation HEAD**: `422582cfecfcf3e55be443abd1b821eec378c112`
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - Installed DSH baseline: `0.1.1-rc.2`
  - Upstream DSH target: tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`
  - Operating System: Linux (CachyOS / 6.18 kernel, x86_64)
  - Hosted CI / GitHub Actions: Not used; local machine execution only
  - Windows: **NOT TESTED**

---

## Executive Summary & Root Cause of Validation Result

### Overall Verdict: `FAIL`
The runtime compound transaction implementation (`packages/project-memory/src/`) is architecturally sound and passes all concurrency, rollback, locking, and integrity probes. However, the automated test suite fails with **exit code 1** due to a broken assertion in [`packages/project-memory/test/tools.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/tools.test.ts#L94-L100).

### Exact Reproducible Cause
1. **Failing Test**: `test/tools.test.ts` -> `"model-facing memory_write reports sanitized failure without creating a topic when Memory map preflight fails"`.
2. **Failure Mechanism**:
   - In commit `75a24c252016f36d261cb3237c0f42af2ac84fdc` (`"test(memory): match sanitized tool error message"`), line 99 of `tools.test.ts` was edited to:
     ```ts
     await assert.rejects(
       () => writeTool.execute(
         { topic: 'architecture', content: 'must-not-persist\n' },
         execution(projectRoot),
       ),
       /^Project memory write failed for topic "architecture"\.$/,
     )
     ```
   - In Node.js v24 (`node:assert/strict`), when `assert.rejects(promise, regex)` receives a `RegExp`, it tests `String(err)`, which evaluates to `err.toString()`:
     `'Error: Project memory write failed for topic "architecture".'`
   - Because the regex is anchored with leading `^Project...`, it fails to match `'Error: Project...'`.
   - **Assertion Error Output**:
     ```text
     AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^Project memory write failed for topic "architecture"\.$/. Input:

     'Error: Project memory write failed for topic "architecture".'
     ```
3. **Command Outcomes**:
   - `pnpm --filter nishi-dsh-project-memory test`: **Exit code 1** (38/39 tests passed, 1 failed).
   - `pnpm test` (full workspace): **Exit code 1** (276/277 tests passed, 1 failed).

Per instruction, no production or test files have been modified.

---

## 1. Exact Files Reviewed

### Production Source Files
1. [`packages/project-memory/src/topic-id.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/topic-id.ts) — Extracted topic identifier validation and constants.
2. [`packages/project-memory/src/bootstrap.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/bootstrap.ts) — In-memory bootstrap preflight and locked `withMemoryMapEntryTransaction`.
3. [`packages/project-memory/src/topics.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/topics.ts) — Compound transaction functions `writeTopicMemoryWithMap` and `editTopicMemoryWithMap`, topic snapshotting, and rollback logic.
4. [`packages/project-memory/src/tools.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/tools.ts) — Model-facing tools `memory_write` and `memory_edit` routing through compound transactions and sanitizing errors.
5. [`packages/project-memory/src/index.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/index.ts) — Root package export boundary with explicit bootstrap exports.
6. [`packages/project-memory/src/filesystem.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/filesystem.ts) — Safe file writer locking with canonical path verification.
7. [`packages/project-memory/src/paths.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/paths.ts) — Deterministic canonical path resolution.

### Test Files
1. [`packages/project-memory/test/compound-transaction.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/compound-transaction.test.ts) — 8 tests covering compound writes, edits, preflight rejects, lock order, and concurrency.
2. [`packages/project-memory/test/tools.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/tools.test.ts) — Real model-facing tool execution and failure sanitization tests.
3. [`packages/project-memory/test/fixtures/rmw-worker.mjs`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/fixtures/rmw-worker.mjs) — Multi-process child worker fixture for cross-process operations.
4. [`packages/project-memory/test/atomic-write.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/atomic-write.test.ts) — Single-file locking tests.
5. [`packages/project-memory/test/package.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/package.test.ts) — Public package manifest boundary tests.
6. [`packages/project-memory/test/project-memory.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/project-memory.test.ts) — Baseline path, bootstrap, bounds, and symlink tests.
7. [`packages/project-memory/test/memory-directives.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/memory-directives.test.ts) — Memory maintenance directives and route tests.
8. [`packages/project-memory/test/project-scope.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/project-scope.test.ts) — Nested session cwd root resolution tests.

### Consistency Documentation
- [`packages/project-memory/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/README.md)
- [`docs/ARCHITECTURE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ARCHITECTURE.md)
- [`docs/ROADMAP.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ROADMAP.md)
- [`docs/HANDOFF.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/HANDOFF.md)
- [`docs/verification/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/verification/README.md)

---

## 2. Package & Workspace Validation Gates

### 2.1 Manifest & Lockfile Gate
- `pnpm install --frozen-lockfile`: **PASS** (Exit code `0`, clean workspace in 295ms).
- `git diff --exit-code -- packages/project-memory/package.json pnpm-lock.yaml`: **PASS** (Exit code `0`, zero drift).

### 2.2 Focused Project Memory Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `1` | **FAIL** | 39 tests executed: 38 passed, 1 failed (`test/tools.test.ts` regex mismatch) |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean with zero diagnostic errors |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | **PASS** | `tsc -p tsconfig.json` clean, emitted to `lib/` |

### 2.3 Full Workspace Verification Gates
| Package | Tests Passed | Tests Failed | Check Exit Code | Build Exit Code |
|---|---|---|---|---|
| `packages/core` | 175 | 0 | 0 | 0 |
| `packages/project-memory` | 38 | 1 | 0 | 0 |
| `packages/antigravity` | 27 | 0 | 0 | 0 |
| `packages/codex` | 23 | 0 | 0 | 0 |
| `packages/suite` | 12 | 0 | 0 | 0 |
| `packages/claude` | 1 | 0 | 0 | 0 |
| **Workspace Total** | **276** | **1** | **0** | **0** |

---

## 3. Detailed Technical Verification

### 3.1 Topic Identity Refactor & Cycle Elimination
- **Extracted File**: [`packages/project-memory/src/topic-id.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/src/topic-id.ts)
- **Contract Fidelity**:
  - `TOPIC_IDENTIFIER_REGEX`: `/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/` (unchanged).
  - `MAX_TOPIC_IDENTIFIER_LENGTH`: `64` (unchanged).
  - `RESERVED_TOPIC_IDENTIFIERS`: `memory`, `con`, `prn`, `aux`, `nul`, `com1`..`com9`, `lpt1`..`lpt9` (unchanged).
  - `isValidTopicIdentifier`: Rejects `memory`, uppercase names (`CON`, `PRN`, `Arch`), special characters, and lengths > 64.
- **Module Dependency Graph**:
  - `topic-id.ts` has 0 internal imports.
  - `bootstrap.ts` imports `{ isValidTopicIdentifier }` from `topic-id.js`.
  - `topics.ts` imports `{ isValidTopicIdentifier }` from `topic-id.js` and `{ withMemoryMapEntryTransaction }` from `bootstrap.js`.
  - `bootstrap.ts` does **NOT** import from `topics.ts`.
  - **Verdict**: Module cycle (`bootstrap <-> topics`) is completely eliminated.

### 3.2 Root Package API Boundary & Export Surface
- **Preserved Root Exports**:
  - Constants: `MAX_BOOTSTRAP_LINES`, `MAX_BOOTSTRAP_BYTES`, `INITIAL_MEMORY_MD_CONTENT`, `MAX_TOPIC_BYTES`, `MAX_TOPIC_IDENTIFIER_LENGTH`, `RESERVED_TOPIC_IDENTIFIERS`, `TOPIC_IDENTIFIER_REGEX`.
  - Helpers: `truncateLines`, `truncateUtf8Buffer`, `boundedUtf8Bootstrap`, `insertTopicIntoMemoryMapContent`, `isValidTopicIdentifier`.
  - Bootstrap Operations: `ensureProjectMemoryBootstrap`, `readProjectMemoryBootstrap`, `writeProjectMemoryBootstrap`, `editProjectMemoryBootstrap`, `ensureMemoryMapEntry`.
  - Storage Operations: `readTopicMemory`, `writeTopicMemory`, `editTopicMemory`, `writeTopicMemoryWithMap`, `editTopicMemoryWithMap`.
  - Lifecycle / Context: `initializeDshProject`, `readDshProjectContext`, `readCanonicalProjectContext`, `resolveProjectMemoryPaths`, `resolveTopicMemoryPath`, `name`, `inject`, `apply`.
- **Internal Coordination Seams**:
  - `withMemoryMapEntryTransaction` and type `CommitMemoryMapEntry` are **NOT** exported from `packages/project-memory/src/index.ts` or emitted in `lib/index.d.ts`.
  - Direct root package imports for `withMemoryMapEntryTransaction` evaluate to `undefined`.

### 3.3 Transaction Preflight & Locked Coordinator (`withMemoryMapEntryTransaction`)
- Validates absolute `projectRoot` and topic identifier validity before proceeding.
- Ensures canonical `.dsh` and `.dsh/memory` directories.
- Takes `MEMORY.md.lock` via `withSafeFileWriterLock(memoryDir, memoryMd, ...)`.
- Reads `MEMORY.md` under lock via `readBootstrapOrInitial`. If absent (`ENOENT`), returns approved initial bootstrap in-memory without creating a file on disk.
- Calculates `insertTopicIntoMemoryMapContent(currentContent, topic)`.
- Validates `MAX_BOOTSTRAP_BYTES` (25 KiB) and `MAX_BOOTSTRAP_LINES` (200 lines) **before** invoking the topic mutation callback.
- If Memory map is malformed (e.g. duplicate `## Memory map` sections), throws during preflight before topic lock is acquired or topic file is touched.
- `commitMap()` is idempotent / one-shot (`let committed = false`). If the topic mutation callback returns without calling `commitMap()`, an explicit programmer-error exception is thrown.

### 3.4 Missing Bootstrap Semantics
- When `MEMORY.md` is absent and a compound topic edit is requested for a missing topic:
  - Operation rejects with `Topic memory file "..." does not exist; cannot edit missing topic`.
  - `MEMORY.md` is **not** created.
  - `<topic>.md` is **not** created.
  - All `.lock` files are deleted cleanly.

### 3.5 Happy-Path Compound Write & Edit
- **Compound Write (`writeTopicMemoryWithMap`)**:
  - Acquires `MEMORY.md.lock` -> preflights map -> acquires `<topic>.md.lock` -> snapshots topic -> writes topic -> commits Memory map -> releases locks.
  - Result DTO: `{ topic: 'architecture', created: true, path: '...' }`.
  - File created at `.dsh/memory/architecture.md`.
  - Canonical map entry `- \`architecture\` → \`.dsh/memory/architecture.md\`` added to `MEMORY.md`.
- **Compound Edit (`editTopicMemoryWithMap`)**:
  - Performs single exact match string replacement under topic lock.
  - If topic was previously unmapped in `MEMORY.md`, compound edit repairs the missing map entry while applying the edit.
  - Overlapping matches and non-unique matches fail closed.

### 3.6 Disposable Probe Results: Fault Injection & Rollback (Probes 7A, 7B, 8, 11)

All disposable probes were executed in isolation outside the working tree (`/home/acedia/.gemini/antigravity/brain/856ae815-71c0-4cb3-a738-4617c50a2b8d/scratch/disposable_probes.mjs`):

#### Probe 7A: Late Map Commit Failure on Newly-Created Topic
- **Fault Injection**: Topic is successfully created under `<topic>.md.lock`; `commitMap()` is forced to reject with a simulated I/O failure.
- **Observed Behavior**:
  - `writeTopicMemoryWithMap` rejects with the original map error.
  - Newly-created `<topic>.md` is removed via `rm()` before releasing `<topic>.md.lock`.
  - `MEMORY.md` remains in its exact baseline state with 0 references to `<topic>`.
  - No orphan files or dangling `.lock` files remain.
- **Verdict**: **PASS**.

#### Probe 7B: Late Map Commit Failure on Existing Topic (Exact Byte-for-Byte Restore)
- **Fault Injection**: Initial topic contains multi-line UTF-8 with special Unicode glyphs (`# Topic Заголовок 🚀\nLine 2: 漢字 and special symbols \u0000\nLine 3: Trailing newline\n`). Topic is overwritten under lock; `commitMap()` is forced to throw `ENOSPC`.
- **Observed Behavior**:
  - `writeTopicMemoryWithMap` rejects with the original `ENOSPC` error.
  - Existing topic file is restored using the in-memory snapshot Buffer via `writeSafeFileAtomically`.
  - Comparison of restored file against initial Buffer: `restoredBuffer.equals(initialBuffer) === true` (100% byte-for-byte exact restore).
  - `MEMORY.md` remains unchanged.
- **Verdict**: **PASS**.

#### Probe 8: Rollback Failure Surfaces Storage `AggregateError`
- **Fault Injection**: Map commit fails, and topic snapshot restore also fails (e.g. destination un-writable or non-regular).
- **Observed Behavior**:
  - `rollbackTopicAfterMapFailure` constructs and throws an `AggregateError`.
  - `errors[0]` contains the original map commit error.
  - `errors[1]` contains the rollback failure error.
  - `cause` is set to the original map commit error.
  - Message explicitly warns: `Project memory transaction for topic "..." failed and topic rollback did not complete cleanly`.
  - Rollback failure is never masked as a clean rollback.
- **Verdict**: **PASS**.

#### Probe 11: Writer Blocking During Mutation & Rollback Window
- **Fault Injection**: Parent transaction holds `<topic>.md.lock` during topic mutation and rollback. A concurrent child worker process launches `topic-write` on the same topic.
- **Observed Behavior**:
  - Child worker acquires `READY` but is blocked on `withSafeFileWriterLock` for `<topic>.md`.
  - Child worker cannot read or overwrite the file while the parent holds the lock or performs rollback.
  - Upon parent releasing the lock, child worker acquires lock and applies its change cleanly without lost updates or race conditions.
- **Verdict**: **PASS**.

### 3.7 Concurrency & Lock Ordering (Probes 9 & 10)
- **Fixed Lock Order**: `MEMORY.md` -> `<topic>.md`.
- **Lock Ordering Proof**: When `MEMORY.md.lock` is externally held, a worker executing `topic-write-map` is blocked immediately. Verification shows that while blocked, `<topic>.md.lock` and `<topic>.md` are **never created**.
- **Concurrent Compound Writes (Different Topics)**: Two OS child processes writing `architecture` and `workflow` concurrently serialize cleanly through `MEMORY.md.lock`. Final state contains both topic files, and each topic appears **exactly once** in `MEMORY.md`.
- **Concurrent Compound Edits (Same Topic)**: Two OS child processes executing `old-a -> new-a` and `old-b -> new-b` on the same topic file serialize under `<topic>.md.lock`. Final content contains both edits (`first=new-a\nsecond=new-b\n`) with zero lost updates and single map entry.

### 3.8 Low-Level vs Model-Facing Tool Separation
- **Low-Level APIs (`writeTopicMemory`, `editTopicMemory`)**:
  - Single-file operations holding `<topic>.md.lock`.
  - Verified empirically: calling low-level write or edit modifies only `<topic>.md` and leaves `MEMORY.md` map untouched.
- **Model-Facing Tools (`memory_write`, `memory_edit`)**:
  - Registered via `apply(ctx)` in `src/tools.ts`.
  - For named topics, route through `writeTopicMemoryWithMap` and `editTopicMemoryWithMap`.
  - For special topic `"memory"`, route through `writeProjectMemoryBootstrap` and `editProjectMemoryBootstrap`.
  - Errors are sanitized via `sanitizeToolError(operation, topic)` returning `Project memory <op> failed for topic "<topic>".` without leaking secret data or internal paths.

### 3.9 Oversized Topic File Behavior (>256 KiB)
- `readTopicSnapshotLocked` validates `stats.size <= MAX_TOPIC_BYTES` (256 KiB) and rejects oversized existing topic files before mutation.
- **Assessment**: This is consistent fail-closed behavior adhering to the documented contract `topic file: at most 256 KiB`. Overwriting oversized invalid files was never a documented recovery contract for compound model-facing transactions. Single-file low-level write or operator deletion can be used if recovery of a non-canonical file is required.

### 3.10 Symlink & Canonical Path Safety
- Pre-acquisition and post-acquisition checks verify canonical directories (`.dsh` and `.dsh/memory`) are real directories and targets are regular files.
- If target is a symlink, write and edit fail closed without following or mutating external referents.
- Rollback target check ensures that if the target was replaced by a symlink during mutation, rollback fails closed rather than following the link.

### 3.11 DSH Compatibility (`0.1.1-rc.2` baseline vs `0.1.2-alpha.1`)
- The Project Memory locking and compound transaction implementation depends only on `@deepseek-ai/dsh-atomic-write.withFileLock` and `@deepseek-ai/dsh-atomic-write.writeFileAtomic`.
- Upstream source at tag `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) contains identical `withFileLock` and `writeFileAtomic` contracts, types, and implementations.
- Zero breaking API changes or vendor model quota dependencies exist.

### 3.12 Crash Durability & Threat Model Limits
- Documentation in [`packages/project-memory/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/README.md) and [`docs/ARCHITECTURE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ARCHITECTURE.md) accurately specifies guarantees for cooperating DSH processes:
  - Serializes cooperating writers through `<target>.lock`.
  - Protects against partial compound failures during normal runtime and I/O errors.
  - Surfaces clean rollback or explicit `AggregateError`.
- Appropriately notes that crash durability (`fsync`) and non-cooperating external root-level processes modifying the directory outside `.lock` are outside the scope of upstream `@deepseek-ai/dsh-atomic-write`.

---

## 4. Git & Working Tree Status

```text
HEAD: 422582cfecfcf3e55be443abd1b821eec378c112
Branch: feat/core-provider-plugins-rc3
Working tree: clean (only docs/verification/gemini/LATEST.md modified)
```

---

## 5. Final Verdict

**`Result: FAIL`**

While the Project Memory compound transaction runtime logic satisfies all locking, serialization, preflight, rollback, and safety requirements, the automated test suite fails on `test/tools.test.ts:94` due to a regex assertion mismatch under Node.js v24 `assert.rejects`.

Per instruction, no implementation or test fixes have been applied. This report is committed and pushed to record the exact validation state.
