# Handoff

Updated for `0.1.0-rc.3` after the fresh independent Core + Project Memory audit, remediation, first Gemini validation, and the narrow fixes for that validation's three Project Memory failures. Foundation remains **REOPENED / PENDING VERIFICATION** until the follow-up validation passes.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`, unpublished.

First remediation implementation checkpoint before documentation-only status updates:

```text
511ef1c2771c8629abb3ae7ba5297208b318f9fe
```

First Gemini validation tested:

```text
70a73869d4fa63f541906ca8b2669f2af089f46f
```

and recorded `FAIL` in `docs/verification/gemini/LATEST.md` because of three concrete Project Memory failures.

Follow-up production fixes were applied at:

```text
e3f84ba5bfbfa75c6492919bdd8dfa9a31c98305
d1863d8712c68b369662cad081b57302300d0c5e
```

Validation must always run from the **actual current branch head**, including this handoff update, not by checking out one of those implementation checkpoints. Confirm the exact head SHA at the start of the run and record it in the raw report.

No publish, merge, tag or release is authorized.

Authoritative DSH compatibility target for this Foundation work:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Local package devDependencies remain rc.2; they are not alpha.1 compatibility evidence.

Windows: **NOT TESTED**.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests

Use `docs/verification/README.md` only for evidence already accepted for its exact historical checkpoint. `docs/verification/gemini/LATEST.md` is the rolling raw Gemini report.

## Foundation audit remediation implemented

The new independent audit found seven confirmed issues and reopened the previous freeze.

### Project Memory

1. **Journal generation race**: delayed cleanup of committed transaction A could delete pending transaction B at the fixed journal pathname.
   - Current journals carry random `transactionId` generations.
   - committed cleanup checks the expected generation;
   - normal successful cleanup now runs while `MEMORY.md` + topic locks are still held;
   - cleanup failure after logical commit is preserve-and-clean, not rollback.

2. **Stale lock replacement race**: stale recovery/finalizer could delete a replacement live owner's lock.
   - Current writers publish populated directory locks containing PID + random token + optional process-birth identity;
   - release/removal is conditional on the exact observed generation and directory identity;
   - delayed removal cannot remove a replacement populated directory;
   - legacy numeric PID regular lock files remain recovery-compatible but are no longer created.

3. **PID reuse**: unrelated live process reusing a dead owner's PID could wedge recovery.
   - Linux process identity uses `/proc/<pid>/stat` start time;
   - macOS uses `ps` process start time;
   - mismatched birth identity means stale owner;
   - unsupported identity seams fail closed and do not guess that a live PID is stale.

4. **Bootstrap ingestion**: 25 KiB bound was previously applied after full file materialization.
   - read-only bootstrap reads bounded prefix only;
   - existence checks read zero bytes;
   - RMW paths reject oversized persisted bootstrap from metadata before whole-file read.

5. **Journal permissions**: committed transition widened `0600` journal to generic `0644`.
   - atomic write accepts explicit mode;
   - pending, claimed and committed journal replacement remains `0600`.

Architectural simplification accepted during this work:

- redundant tool-layer recovery was removed; domain operations own recovery.
- explicit transaction/lock generations are retained even though they add fields, because they remove ambiguous PID/pathname states that caused the HIGH races.

### Core

6. **Legacy logout TOCTOU**: `describeRecord()` kind check followed by unconditional `deleteRecord()` could erase a replacement API-key credential.
   - exact alpha.1 CredentialProvider has no atomic compare-and-delete seam;
   - destructive legacy-grant logout is therefore disabled/fail-closed;
   - logout RPC rejects the unsafe mutation;
   - browser no longer renders legacy Sign Out; legacy grant remains informational state.

7. **Usage invalidation**: invalidate token previously did not actually drop cache; cached APIs/browser could keep superseded `FRESH` state.
   - invalidation deletes host cache immediately and advances observation generation;
   - cached read APIs omit invalidated provider;
   - a pre-invalidation refresh cannot republish after invalidation;
   - post-invalidation refresh need not join superseded in-flight work;
   - authoritative browser cached-read omission clears prior local `FRESH` usage before `ensureFresh`.

Architectural items deliberately **not** simplified before verification:

- exported authorization client begin/submit/cancel/polling state machine — possible public compatibility surface;
- Connection `Function.length` rc2/alpha shim — retained while rc2 is a declared peer;
- usage invalidation generation token — now has a real correctness role;
- fixed Project Memory journal pathname — generation identity + lock order close the audited race without a larger migration.

## First Gemini validation — FAIL and narrow follow-up fixes

The first independent Gemini run used Node `24.19.0`, pnpm `11.21.0`, local rc.2 workspace packages and a disposable official alpha.1 checkout at exact commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.

It reported:

- Core `182/182` focused tests PASS, check PASS, build PASS;
- Project Memory `64` focused tests: `62` PASS / `2` FAIL, with additional concurrency failure observed in the full workspace run;
- workspace check/build PASS;
- workspace test and `verify:local` FAIL because of Project Memory;
- real alpha.1 memory tool probes PASS;
- Core alpha.1 Connection/auth/usage probes PASS.

Three concrete Project Memory causes were identified and fixed without expanding scope:

1. **Lock acquisition collision race**
   - Old remediation classified `ENOTEMPTY` / `ENOTDIR` by re-statting `<target>.lock` after `rename()` failed.
   - A holder could release between the failed `rename()` and that `lstat()`, turning a real contention result into a thrown syscall error.
   - Current code treats structural `rename()` collision errno values as authoritative contention without a pathname recheck.
   - Lock temp-directory/marker preparation errors are no longer accidentally classified as lock contention; collision classification is scoped to the publication `rename()` only.

2. **Concurrent journal unlink during safe read**
   - An unlocked recovery preflight could open `project-memory-transaction.json` just before the committing process unlinked it, then fail its pathname identity `lstat()` with `ENOENT`.
   - Current `readRegularFile()` treats this exact open-then-unlink case as current namespace absence and returns `null`, while replacement by a different inode/symlink still fails closed.

3. **Legacy journal owner transfer assertion**
   - Legacy journals have no `transactionId`, and the first remediation incorrectly included mutable `ownerPid` in `sameTransactionGeneration()`.
   - Recovery claim legitimately changes owner fields, and the existing fail-closed owner-transfer test expected owner changes to reach the explicit ownership check.
   - Current code defines legacy generation from immutable topic + exact participant snapshots and checks owner PID/identity separately.
   - A changed live owner gets the specific fail-closed live-owner error; a changed dead owner also fails closed rather than being claimed.

No redundant new tests were added for these three causes because the first Gemini run proved that existing `atomic-write`, `compound-transaction`, and `transaction-recovery` tests already reproduce them and were red on the failed checkpoint. Those exact suites are mandatory in the follow-up run.

## Regression coverage

Core audit regressions cover:

- immediate invalidation removal from every cached read path;
- invalidation racing an in-flight refresh;
- browser authoritative cache omission causing refresh;
- fail-closed legacy logout with zero credential read/delete calls.

Project Memory audit regressions cover:

- delayed old journal cleanup vs next transaction generation;
- writer finalizer vs replacement lock;
- stale cleanup vs replacement lock generation;
- bounded prefix ingestion seam;
- journal `0600` after committed transition;
- PID-reuse recovery on Linux/macOS;
- upstream `@deepseek-ai/dsh-atomic-write` treating current directory lock as contention.

Existing compound/multi-process/cancellation/recovery tests remain relevant and must all be rerun. In particular, the follow-up must rerun the exact suites that caught the first validation failures: `atomic-write.test.ts`, `compound-transaction.test.ts`, and `transaction-recovery.test.ts`.

## Immediate task — follow-up independent Gemini validation

Do **not** implement more cleanup before this gate unless validation exposes another concrete problem.

Gemini should validate, not repair, unless explicitly authorized.

Required run:

1. fetch/pull current `feat/core-provider-plugins-rc3` and record exact head SHA;
2. verify working tree clean before tests;
3. use Node `24.19.0` / pnpm `11.21.0` environment where available;
4. `pnpm install --frozen-lockfile`;
5. first rerun Project Memory focused tests that were red in the previous report, especially `atomic-write.test.ts`, `compound-transaction.test.ts`, and `transaction-recovery.test.ts`;
6. run the complete Project Memory focused suite and record fresh total/pass/fail counts;
7. Project Memory `check` and `build`;
8. rerun Core focused tests, check and build to prove follow-up edits did not regress the previously green Core foundation;
9. full workspace test/check/build;
10. `pnpm verify:local`;
11. repeat concurrency-sensitive Project Memory suites enough times to exercise lock handoff, compound writes/edits, recovery and cancellation/settlement;
12. explicitly verify that lock handoff no longer leaks raw `ENOTEMPTY` / `ENOTDIR` from a legitimate contention/release race;
13. explicitly verify that concurrent journal disappearance during recovery preflight behaves as absence/retry rather than `Canonical target ... changed while it was being opened`;
14. explicitly verify the legacy dead-owner -> live-owner transfer test reaches the intended fail-closed ownership error;
15. verify no successful/recovered exercised path leaves unexpected `.lock` or `project-memory-transaction.json` protocol state;
16. explicitly validate both lock interoperability directions with `@deepseek-ai/dsh-atomic-write`;
17. use a disposable dependency/runtime environment against official exact DSH alpha.1 commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`; do not treat rc.2 devDependencies as compatibility proof;
18. rerun real alpha.1 `memory_read`, `memory_write`, `memory_edit`, recovery/cancellation/settlement probes affected by Project Memory filesystem changes;
19. rerun Core alpha.1 Connection authorization/usage smoke probes or equivalent previously passing probes to confirm no cross-package regression;
20. independently review the two follow-up fixes for new races, deadlocks, path/symlink regressions, unsafe disappearance handling, legacy ABA/ownership ambiguity and unnecessary complexity;
21. confirm current canonical docs match actual behavior;
22. confirm GitHub Actions/hosted CI were not used and `.github/workflows` was not inspected/edited;
23. Windows remains NOT TESTED;
24. overwrite only `docs/verification/gemini/LATEST.md` with the new raw PASS/FAIL report and commit/push that report even on FAIL.

A PASS must include actual command exit codes, exact branch head tested, exact upstream alpha.1 commit used, fresh focused/full test counts, repeated-concurrency results and any skipped/platform-specific cases. Do not reuse the first validation counts as current evidence.

## After Gemini

- FAIL -> read fresh `docs/verification/gemini/LATEST.md`, fix only proven causes, add/retain regression coverage, rerun the necessary gates.
- PASS -> independently inspect the fresh report, fold accepted durable evidence into `docs/verification/README.md`, update Foundation status to FROZEN in canonical docs, then resume Codex provider work.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Do not add destructive legacy credential deletion until the credential contract offers a reviewed atomic-safe mutation.
- Read command exit codes directly; avoid pipelines that mask failures.
- Windows remains **NOT TESTED**.
