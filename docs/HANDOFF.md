# Handoff

Updated for `0.1.0-rc.3` during Core and Project Memory compatibility/integrity remediation against DSH `0.1.2-alpha.1`.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

The previous Core and Project Memory acceptance remains valid for the installed DSH `0.1.1-rc.2` baseline, but both packages are **REOPENED** after reproducible findings against official DSH tag:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Do not resume provider cleanup until the foundation remediation in `ROADMAP.md` is complete.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README, then exact source/tests being changed

For DSH compatibility questions, use actual upstream source/contracts at the exact tag/commit above as primary truth. Documentation may lag implementation.

## Completed remediation in this audit

### Project Memory maintenance route

Accepted:

- implementation `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1`;
- regression test `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`;
- Gemini report commit `10020983856a1137f286c83f9ed68c0a62605f58`;
- 25/25 package tests PASS;
- typecheck/build PASS;
- disposable alpha.1 `installModelSelection` probe PASS.

### Core Connection/client compatibility

Accepted implementation HEAD `59512d51e55f8121eccdb934e01523e4436b289c` and Gemini report commit `c991bb6ece48acb02d5c15bce3b2b970c3da391a`.

Accepted result includes 169/169 Core tests, check/build/frozen-lockfile PASS, rc.2 + alpha.1 Connection registration/lifecycle PASS, retired Connection/client seams removed from the production boundary, and alpha.1 Host/Origin + browser-auth security probes PASS.

### Core registry observer / registration transaction

Accepted implementation HEAD `b925e2a328168e7c978126fc6474b7af11d7a63d` and Gemini report commit `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

Accepted result includes 175/175 Core tests, full workspace test/check/build PASS, non-vetoing sync/async registry observers, no unhandled observer rejection, intact post-record rollback, stale-disposer safety and preflight validation of usage policy/collector/default policy.

Core source/runtime blockers found in this reopened audit are closed. Core remains formally reopened only for final supported-version-range reconciliation and joint foundation re-freeze after Project Memory remediation.

## Immediate task: validate Project Memory inter-process RMW locking

The implementation is now on the branch. Do not mix the next compound topic/map transaction fix into this validation.

DSH `@deepseek-ai/dsh-atomic-write` exposes the same `withFileLock()` contract in both installed `0.1.1-rc.2` and upstream `0.1.2-alpha.1`. It uses a `wx`-created `<file>.lock` sibling and is explicitly intended to serialize read-modify-write cycles across processes.

Implemented contract:

1. `withSafeFileWriterLock()` in `src/filesystem.ts` uses the exact target file as the lock namespace and revalidates the canonical parent/existing target after acquisition.
2. `MEMORY.md` bootstrap create/write/edit and Memory-map updates all honor the same `MEMORY.md.lock`.
3. Whole-file topic writes and topic exact edits honor the same `<topic>.md.lock`.
4. Root `.gitignore` initialization/update honors `.gitignore.lock` and preserves unrelated existing content.
5. Readers remain lock-free; atomic rename still provides old-or-new reads.
6. `DSH.md` and `.dsh/project.json` remain create-if-absent `wx` state, not RMW documents.
7. Per-file locking is intentionally not a cross-file transaction: topic mutation followed by `MEMORY.md` map mutation remains the next separate blocker.

Cross-process regression coverage uses real child Node processes with the `tsx` loader. Tests pre-hold the target DSH writer lock, prove child operations cannot complete while it is held, then release it and verify independent changes survive after each process re-reads under the lock.

Validation must cover:

- `packages/project-memory/src/filesystem.ts`
- `packages/project-memory/src/bootstrap.ts`
- `packages/project-memory/src/topics.ts`
- `packages/project-memory/src/init.ts`
- `packages/project-memory/test/atomic-write.test.ts`
- `packages/project-memory/test/fixtures/rmw-worker.mjs`

After this passes, the next block is compound topic + `MEMORY.md` failure/partial-commit semantics.

## Remaining confirmed foundation blockers

1. Project Memory per-file inter-process RMW serialization is implemented and **awaiting validation**.
2. Project Memory topic + Memory-map compound mutations need explicit failure/partial-commit handling and tests.
3. DSH peer/dev version declarations must be reconciled only after source compatibility is proven.
4. Core + Project Memory must then be re-frozen against the intended supported DSH family.

`ROADMAP.md` owns completion status and order.

## Invariants to preserve

- providers register through the shared `registerProvider()` path;
- Core has no provider-package dependency;
- outer `nishi-core` publishes `NishiProvidersService` before the inner host child;
- Core does not depend on `dsh-authorization`;
- web search follows the exact current request route and never silently falls back;
- capability absence is legal;
- registry observers cannot veto committed topology changes;
- provider-owned usage contract errors that can reject registration happen before registry mutation;
- Project Memory context/tools use one root policy;
- Project Memory canonical path/symlink confinement remains fail-closed;
- all Project Memory writers that can race one target's RMW cycle honor that same target lock;
- per-file locks are not represented as a transaction across topic + Memory map;
- vendor-specific delegation tools stay removed;
- no vendor credential/session/token stores are copied, parsed, migrated or deleted.

## Development workflow

The assistant edits GitHub; Gemini validates on the maintainer's local machine.

For each narrow issue:

1. Fetch the current target file and SHA from `feat/core-provider-plugins-rc3` immediately before editing.
2. Make one logically complete change with focused tests.
3. Provide one complete Gemini validation prompt.
4. Gemini uses:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini validates but does not repair implementation unless explicitly authorized.
6. Gemini overwrites only `docs/verification/gemini/LATEST.md`.
7. Gemini commits/pushes `LATEST.md` even on FAIL.
8. Maintainer replies `готово`.
9. Assistant reads fresh `LATEST.md`; on FAIL fix the exact cause, on PASS fold durable evidence into `docs/verification/README.md` and continue.

## Validation baselines

Local installed baseline:

- Node `v24.19.0` through fnm;
- pnpm `11.21.0`;
- DSH `0.1.1-rc.2`.

Compatibility source target:

- DSH tag `dsh-v0.1.2-alpha.1`;
- upstream commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.

Do not update the main working copy to alpha.1 merely to probe compatibility. Prefer disposable environments until package dependency migration is intentionally part of the scoped change.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the Suite runtime lock graph.
- Windows remains **NOT TESTED**.
- Read command exit codes directly; avoid pipelines that mask failures.

## After foundation remediation

Resume the fixed product sequence:

1. Codex
2. Antigravity
3. Claude
4. repository-wide provider invariants
5. cross-provider/product live acceptance
6. install/profile lifecycle
7. release gate

`ROADMAP.md` owns exact status.
