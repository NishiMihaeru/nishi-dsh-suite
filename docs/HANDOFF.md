# Handoff

Updated for `0.1.0-rc.3` after the fresh independent Core + Project Memory audit and implementation remediation. Foundation is **REOPENED / PENDING VERIFICATION**.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`, unpublished.

Implementation/test checkpoint produced by the remediation before documentation-only status updates:

```text
511ef1c2771c8629abb3ae7ba5297208b318f9fe
```

Validation must still run from the **actual current branch head**, not by checking out that checkpoint, because current canonical documentation is intentionally ahead of it. Confirm the exact head SHA at the start of the run and record it in the raw report.

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

## Regression coverage added

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

Existing compound/multi-process/cancellation/recovery tests remain relevant and must all be rerun.

## Immediate task — independent Gemini validation

Do **not** implement more cleanup before this gate unless validation exposes a concrete problem.

Gemini should validate, not repair, unless explicitly authorized.

Required run:

1. fetch/pull current `feat/core-provider-plugins-rc3` and record exact head SHA;
2. verify working tree clean before tests;
3. use Node `24.19.0` / pnpm `11.21.0` environment where available;
4. `pnpm install --frozen-lockfile`;
5. run Core focused tests including `packages/core/test/audit-regressions.test.ts` and existing lifecycle/RPC suites;
6. Core `check` and `build`;
7. run Project Memory focused tests including `audit-regressions`, compound transaction, filesystem/symlink, cancellation and multi-process suites;
8. Project Memory `check` and `build`;
9. full workspace test/check/build;
10. `pnpm verify:local`;
11. run adversarial/repeated Project Memory race tests, especially lock replacement, concurrent transaction generations, stale recovery and cancellation/settlement;
12. verify no successful/recovered exercised path leaves unexpected `.lock` or `project-memory-transaction.json` protocol state;
13. explicitly validate both lock interoperability directions with `@deepseek-ai/dsh-atomic-write`;
14. create/use a disposable dependency environment against official exact DSH alpha.1 commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` rather than treating rc.2 devDependencies as compatibility proof;
15. execute real alpha.1 `memory_read`, `memory_write`, `memory_edit` and changed recovery/cancellation paths;
16. exercise Core authorization status/fail-closed legacy logout and Usage Limits invalidation through the real alpha.1 Connection host/client seam where practical;
17. independently review the changed code for new races, deadlocks, type/API mismatches, security regressions and unnecessary complexity; do not assume the implementation strategy is correct merely because tests pass;
18. confirm current canonical docs match actual behavior;
19. confirm GitHub Actions/hosted CI were not used and `.github/workflows` was not inspected/edited;
20. Windows remains NOT TESTED;
21. overwrite only `docs/verification/gemini/LATEST.md` with the raw PASS/FAIL report and commit/push that report even on FAIL.

A PASS must include actual command exit codes, exact branch head tested, exact upstream alpha.1 commit used, focused/full test counts, and any skipped/platform-specific cases. Do not reuse historical counts.

## After Gemini

- FAIL -> read fresh `docs/verification/gemini/LATEST.md`, fix only proven causes, add regression coverage, rerun the necessary gates.
- PASS -> independently inspect the fresh report, fold accepted durable evidence into `docs/verification/README.md`, update Foundation status to FROZEN in canonical docs, then resume Codex provider work.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Do not add destructive legacy credential deletion until the credential contract offers a reviewed atomic-safe mutation.
- Read command exit codes directly; avoid pipelines that mask failures.
- Windows remains **NOT TESTED**.
