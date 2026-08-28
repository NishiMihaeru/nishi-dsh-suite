# Core + Project Memory Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all five confirmed Core/Project Memory audit findings against DeepSeek Harness `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) without broad refactors.

**Architecture:** Core will preserve a visible distinction between credential-store failure and an absent grant, and failed legacy deletion will reject instead of reporting success. Project Memory will consolidate safe file reads/writes behind a filesystem primitive, add atomic no-clobber first publication, propagate cancellation through lock acquisition and commits, and add a small write-ahead recovery record for compound topic/map mutations so a process death restores the pre-transaction state on the next initialization/operation.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Cordis/DSH alpha.1 contracts, `@deepseek-ai/dsh-atomic-write`, Node test runner.

**Spec:** Independent Core + Project Memory audit completed on branch `feat/core-provider-plugins-rc3`, remote HEAD `42203ca50ea2555cfcc675d9c73e52bb86a48324`.

## Global Constraints

- Compatibility target is only DeepSeek Harness `0.1.2-alpha.1` for this implementation audit/fix pass.
- Keep existing `0.1.1-rc.2 || 0.1.2-alpha.1` published peer range unless a concrete incompatibility requires otherwise.
- Do not inspect or modify `.github/workflows` or CI/status configuration.
- Do not modify vendor credential/session/token stores outside the existing test fixtures.
- Windows remains NOT TESTED.
- No publish, merge, tag, or release.
- Use test-first changes: each production behavior change is preceded by a regression test that fails on the pre-fix implementation.

---

### Task 1: Core authorization storage-failure semantics

**Files:**
- Modify: `packages/core/test/authorization-rpc.test.ts`
- Modify: `packages/core/src/host/authorization-rpc.ts`

**Interfaces:**
- Consumes: alpha.1 `CredentialProvider.describeRecord()` and `deleteRecord()` rejecting Promise contracts.
- Produces: storage-read failures project `status: 'ERROR'` with generic safe text; failed legacy deletion rejects so RPC returns generic `internal` failure.

- [ ] Add a test proving `describeRecord()` rejection produces a safe `ERROR` DTO rather than `NOT_CONFIGURED`.
- [ ] Add a test proving `deleteRecord()` rejection is not swallowed by `logout()`/RPC.
- [ ] Verify both tests fail against the current implementation.
- [ ] Implement the minimal controller changes.
- [ ] Run the focused authorization tests and Core tests.

### Task 2: Safe filesystem primitive and cancellation-aware writer locking

**Files:**
- Modify: `packages/project-memory/src/filesystem.ts`
- Modify: `packages/project-memory/test/atomic-write.test.ts`
- Modify as needed: `packages/project-memory/src/context.ts`, `packages/project-memory/src/bootstrap.ts`, `packages/project-memory/src/topics.ts`, `packages/project-memory/src/init.ts`

**Interfaces:**
- Produces: safe canonical-file read helper using an opened file handle plus identity validation; canonical write helper anchored to an opened directory descriptor when the host exposes `/proc/self/fd` or `/dev/fd`; cancellation-aware `<target>.lock` acquisition compatible with DSH's lock namespace; safe file removal.

- [ ] Add regression coverage for cancellation while waiting on an existing writer lock.
- [ ] Add deterministic coverage for validation/use replacement by exercising the opened-handle/anchored-directory primitive rather than pathname re-open.
- [ ] Verify the new tests fail against current helpers.
- [ ] Implement the minimal filesystem primitive and keep the existing `.lock` protocol compatible with DSH `withFileLock()`.
- [ ] Route Project Memory reads/writes through the primitive.
- [ ] Run filesystem/project-memory focused tests.

### Task 3: Atomic no-clobber first publication

**Files:**
- Modify: `packages/project-memory/src/filesystem.ts`
- Modify: `packages/project-memory/src/bootstrap.ts`
- Modify: `packages/project-memory/src/init.ts`
- Modify: `packages/project-memory/test/project-memory.test.ts`
- Modify: `packages/project-memory/test/atomic-write.test.ts`

**Interfaces:**
- Produces: `writeFileExclusiveAtomic(...)` that writes complete content to a sibling temp file and atomically publishes it with a no-clobber hard link; an existing winner is never overwritten.

- [ ] Add tests for first-publication visibility/no-clobber behavior and interrupted temp publication cleanup/retry semantics.
- [ ] Verify failures on the current `writeFile(..., {flag:'wx'})` implementation.
- [ ] Replace first-create paths for `DSH.md`, `.dsh/project.json`, `MEMORY.md`, and fresh `.gitignore` with the no-clobber primitive.
- [ ] Run initializer/bootstrap tests.

### Task 4: Cooperative cancellation through Project Memory operations

**Files:**
- Modify: `packages/project-memory/src/tools.ts`
- Modify: `packages/project-memory/src/runtime.ts`
- Modify: `packages/project-memory/src/bootstrap.ts`
- Modify: `packages/project-memory/src/topics.ts`
- Modify: `packages/project-memory/src/init.ts`
- Modify: `packages/project-memory/test/tools.test.ts`
- Modify: relevant runtime tests in `packages/project-memory/test/project-memory.test.ts`

**Interfaces:**
- All mutating/read APIs accept optional `AbortSignal` where needed internally.
- Writer lock acquisition aborts without waiting for lock release and no mutation occurs after cancellation.

- [ ] Add a real model-facing `memory_write` cancellation-under-lock regression test.
- [ ] Add lazy-init cancellation coverage.
- [ ] Verify the tests fail against the current implementation.
- [ ] Thread `AbortSignal` through root discovery, initialization, reads, locks, render, and final commits; check immediately before every durable mutation.
- [ ] Run Project Memory tests.

### Task 5: Crash-recoverable compound topic + Memory-map transaction

**Files:**
- Create: `packages/project-memory/src/transaction.ts`
- Modify: `packages/project-memory/src/topics.ts`
- Modify: `packages/project-memory/src/init.ts`
- Modify: `packages/project-memory/src/index.ts` only if a public recovery entry is required (prefer internal-only).
- Modify: `packages/project-memory/test/compound-transaction.test.ts`
- Modify: `packages/project-memory/test/fixtures/rmw-worker.mjs` if process-level crash coverage needs a worker mode.

**Interfaces:**
- Produces: one project-local pending transaction record under `.dsh/local/` containing the exact pre-transaction topic and MEMORY states plus topic id/owner PID.
- Journal presence means the transaction is uncommitted; recovery restores the exact pre-transaction state and removes the journal before normal work continues.

- [ ] Add a deterministic test representing process death after the topic replacement but before the map commit, then run recovery and assert exact pre-state restoration.
- [ ] Verify it fails because current code has no recovery record/path.
- [ ] Write the pending record atomically before the first durable participant mutation.
- [ ] Remove the record only after both topic and map commits succeed.
- [ ] On normal failure, restore exact previous bytes and remove the record; retain aggregate errors if rollback fails.
- [ ] Invoke recovery before initialization/tool mutation can expose inconsistent state.
- [ ] Run compound transaction and all Project Memory tests.

### Task 6: Documentation and verification

**Files:**
- Modify: `packages/core/README.md`
- Modify: `packages/project-memory/README.md`
- Modify source comments whose old guarantees are no longer precise.

- [ ] Update acceptance/freeze text only after the implementation and tests support it.
- [ ] Run focused Core tests.
- [ ] Run focused Project Memory tests.
- [ ] Run the full workspace test/verify commands available in the repository, excluding prohibited CI workflows.
- [ ] Inspect the final diff for accidental provider-specific or workflow changes.
