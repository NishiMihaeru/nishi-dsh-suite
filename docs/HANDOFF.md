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

### Project Memory maintenance route — PM03

Accepted implementation/test through `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`, Gemini report commit `10020983856a1137f286c83f9ed68c0a62605f58`, 25/25 tests, check/build and disposable alpha.1 model-selection probe PASS.

### Core Connection/client compatibility — Core 15

Accepted implementation HEAD `59512d51e55f8121eccdb934e01523e4436b289c` and Gemini report commit `c991bb6ece48acb02d5c15bce3b2b970c3da391a`.

Accepted result includes 169/169 Core tests, check/build/frozen-lockfile PASS, rc.2 + alpha.1 Connection registration/lifecycle PASS, retired Connection/client seams removed from the production boundary, and alpha.1 Host/Origin + browser-auth security probes PASS.

### Core registry observer / registration transaction — Core 16

Accepted implementation HEAD `b925e2a328168e7c978126fc6474b7af11d7a63d` and Gemini report commit `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

Accepted result includes 175/175 Core tests, full workspace test/check/build PASS, non-vetoing sync/async registry observers, no unhandled observer rejection, intact post-record rollback, stale-disposer safety and preflight validation of usage policy/collector/default policy.

### Project Memory inter-process RMW integrity — PM04

Accepted implementation HEAD:

```text
eae9caf03f8896f344d7c73b2f67d67cb9f86e9c
```

Gemini report commit:

```text
02e0dca62f49fc2ef6bba8626ae028c7da3986e2
```

Accepted result:

- 29/29 Project Memory tests PASS;
- full workspace test/check/build PASS (267 tests total);
- rc.2 and alpha.1 `withFileLock()` contracts confirmed identical;
- same-file RMW lost updates closed for `MEMORY.md`, topic files and `.gitignore`;
- real child-process stress retained all Memory-map entries and independent topic edits;
- whole-file writers participate in the same per-target locks;
- foreign lock timeout preserves foreign lock + target;
- operation failures clean own locks;
- target/lock/canonical-parent symlink safety PASS;
- concurrent initializer stress and disposable alpha.1 lock probe PASS.

Core source/runtime blockers found in this reopened audit are closed. Project Memory now has one remaining implementation validation block before version reconciliation.

## Immediate task: validate Project Memory compound topic + Memory-map transactions

The implementation is on the branch. Do not mix dependency-range changes into this validation.

The old model-facing named-topic path was:

```text
topic mutation -> release topic lock -> MEMORY.md map update
```

That allowed `memory_write` / `memory_edit` to report failure after the topic had already changed, and a naive later rollback could itself overwrite a concurrent writer.

Implemented contract:

1. Topic identity validation was separated into `src/topic-id.ts` so bootstrap coordination no longer depends on `topics.ts` and the compound path has no module cycle.
2. `withMemoryMapEntryTransaction()` holds `MEMORY.md.lock`, re-reads/preflights the canonical Memory-map render and bootstrap bounds before any topic mutation, and exposes a one-shot map commit while the lock remains held.
3. Missing `MEMORY.md` is represented by approved initial content in memory; it is not created until successful map commit.
4. Model-facing named-topic `memory_write` / `memory_edit` use `writeTopicMemoryWithMap()` / `editTopicMemoryWithMap()`.
5. Compound lock order is always:

   ```text
   MEMORY.md -> <topic>.md
   ```

6. Topic snapshot + mutation happen under the nested topic lock.
7. Memory-map commit happens while both locks remain held.
8. If the late map commit fails, rollback happens before topic lock release:
   - existing topic -> exact prior bytes restored;
   - newly created topic -> removed;
   - rollback failure -> `AggregateError` retaining original map error and rollback error.
9. Low-level `writeTopicMemory()` / `editTopicMemory()` remain single-file helpers and intentionally do not touch the Memory map.
10. Model-facing tool errors remain sanitized; storage-layer tests/review must still prove the actual transaction behavior underneath that sanitization.

Focused tests now include:

- happy-path topic + map commit;
- invalid/ambiguous Memory-map preflight leaves new/existing topic untouched;
- compound edit repairs a missing map entry;
- separate-process concurrent compound writes retain every topic/map pair;
- separate-process concurrent compound edits retain independent changes;
- lock-order proof that topic lock is not acquired while `MEMORY.md.lock` is externally blocked;
- actual `apply()`-registered `memory_write` / `memory_edit` execution and sanitized failure behavior.

Gemini must additionally force a **late Memory-map commit failure after topic mutation** in a disposable filesystem probe and verify rollback for both a newly-created topic and an existing topic. Do not patch production code to create the failure; use filesystem/process timing or a disposable instrumented copy/probe if necessary.

## Remaining foundation blockers after this validation

1. Compound Project Memory transaction validation. **ACTIVE**
2. Reconcile Core + Project Memory DSH peer/dev version declarations with the actual supported DSH family.
3. Final rc.2 + alpha.1 focused/full-workspace foundation validation.
4. Re-freeze Core + Project Memory.

Then resume provider cleanup in the fixed sequence: Codex -> Antigravity -> Claude.

## Invariants to preserve

- providers register through the shared `registerProvider()` path;
- Core has no provider-package dependency;
- outer `nishi-core` publishes `NishiProvidersService` before the inner host child;
- Core does not depend on `dsh-authorization`;
- web search follows the exact current request route and never silently falls back;
- capability absence is legal;
- registry observers cannot veto committed topology changes;
- Project Memory context/tools use one root policy;
- Project Memory canonical path/symlink confinement remains fail-closed;
- same-file RMW writers honor the same target lock;
- compound named-topic writes/edits acquire Memory then topic locks in one fixed order;
- normal map failure cannot leave a named topic mutated;
- rollback failure is explicit, not hidden;
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
