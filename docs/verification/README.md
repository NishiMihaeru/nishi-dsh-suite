# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, fold the durable result into this ledger. Older raw reports and removed acceptance documents remain available through git history; do not recreate them as new dated files.

## Environment baseline

Accepted provider-independent validation uses:

- Node `v24.19.0` from fnm;
- pnpm `11.21.0`;
- DSH `0.1.1-rc.2`;
- Linux/CachyOS local environment;
- GitHub Actions/hosted CI: not used;
- Windows: **NOT TESTED**.

## Core stabilization

Core 01–14 are complete and the package is **DONE / FROZEN**.

| Gate | Accepted result |
|---|---|
| Core 01 | usage lifecycle/race safety PASS |
| Core 02 | UTF-8 streaming split-chunk decoding PASS |
| Core 03 | canonical provider ids/routes PASS |
| Core 04 | workspace confinement PASS |
| Core 05 | transactional provider registration rollback PASS |
| Core 06 | registered provider without usage capability remains visible as unsupported PASS |
| Core 07 | browser/client stale async lifecycle protection PASS |
| Core 08 | shared `VendorFailure` contract/recognizer behavior PASS |
| Core 09 | direct core `dsh-subagent` dependency removed PASS |
| Core 10 | provider-neutral boundary + unfamiliar fourth-provider extension proof PASS |
| Core 11 | root injection/lifecycle boundary PASS after correction |
| Core 12 | direct core `dsh-authorization` dependency removed PASS |
| Core 13 | canonical Web Search route parsing/error taxonomy PASS |
| Core 14 | final package/install/real DSH boot/unload-remount acceptance PASS |

Core 14 final acceptance included:

- full local workspace gate;
- six rc.3 tarballs;
- disposable Suite installation;
- installed imports for Core public subpaths;
- real DSH host boot + HTTP readiness;
- real agent-plane `nishi-dsh-core/web-search` mount;
- unload/remount without duplicate registry/usage/RPC services.

The real boot gate caught the registry-injection lifecycle bug that unit tests had missed. Final accepted lifecycle is recorded in `docs/ARCHITECTURE.md`.

## Project Memory stabilization

Project Memory is **DONE / FROZEN**.

| Gate | Accepted result |
|---|---|
| PM01 | one root policy for context/tools; nested Git/worktree/non-Git cases PASS |
| PM02 | package/workspace + atomic-write + Cordis commands/llm + disposable real DSH boot PASS |

Accepted behavior includes:

- no nested split-brain `.dsh/memory` tree;
- canonical path/symlink refusal;
- `@deepseek-ai/dsh-atomic-write` replacement writes;
- `/memory` and `/consolidate` require `commands + llm`;
- repository-shared memory policy excludes secret/transient/operator-personal data.

## Documentation consolidation

Current documentation structure and source-of-truth rules are accepted after a full Gemini rerun on commit `efabdf0f10fc4851a2446bab8678417fa9b3af88`.

Accepted result:

- exactly eight current files under `docs/`;
- `docs/README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `HANDOFF.md`, and `RELEASE.md` have non-overlapping ownership;
- `docs/verification/README.md` is the durable ledger;
- `docs/verification/gemini/LATEST.md` is the only rolling raw Gemini report;
- old plans/specs/session summaries/acceptance reports/detailed Gemini reports were removed from the current tree and remain recoverable through git history;
- no active references remain to deleted `docs/superpowers`, `docs/acceptance`, or old `docs/release/*` paths;
- Core registration source remained functionally unchanged after comment/reference cleanup;
- focused Core gate passed: 165 tests, typecheck PASS, build PASS;
- full `pnpm verify:local` PASS with all workspace gates and six rc.3 tarballs;
- no blocking documentation consistency issues remain.

Future agents must update canonical docs in place rather than creating new dated plans, handoffs, session summaries or per-task verification reports.

## Codex live-probe contract repair

The stale rc.2/early-rc.3 Codex primary live fixture was corrected and accepted on commit `4c75129a7f766d415182441d91ed1e8e1ca8a50d`.

Accepted result:

- live primary fixture uses the registry-first rc.3 contract and mounts without a `subagents` service;
- vendor-specific `CODEX_SUBAGENT_OK` live acceptance was removed because Codex delegation is no longer part of rc.3;
- executable override uses `env.DSH_CODEX_EXECUTABLE`, not the removed `config.executable` field;
- provider `codex` and route `codex-app-server` register successfully;
- Codex package tests PASS: 31/31;
- Codex typecheck PASS;
- Codex build PASS;
- real `test:live:primary` PASS with model `gpt-5.6-sol` returning `CODEX_PRIMARY_OK`;
- adapter/process teardown completed cleanly with no lingering child process.

This closes only the stale live-fixture inconsistency. Remaining Codex cleanup and final provider acceptance stay open in `ROADMAP.md`.

## Historical release/acceptance baseline

Published `0.1.0-rc.1` historically passed Linux/CachyOS local and registry-only installation smoke, including Suite resolution, managed preset lifecycle and normal removal. rc.2 was intentionally parked unpublished after local/live work.

Those old package layouts and vendor-specific subagent surfaces are historical only. Exact old acceptance/release documents were removed from the current tree to prevent agents treating them as active instructions; they remain in git history.

## Current open validation

Provider-independent foundation is complete. Open rc.3 validation is only:

1. Codex provider cleanup + focused/local/live provider acceptance.
2. Antigravity provider cleanup/catalog tests + focused/local/live provider acceptance.
3. Claude usage-only provider cleanup/smoke.
4. Repository-wide provider invariant sweep.
5. Cross-provider/product live acceptance.
6. Final profile/install/release gates.

See `docs/ROADMAP.md` for task order and `docs/HANDOFF.md` for the immediate next run.

## Validation workflow

For each issue Gemini should:

1. pull the current branch;
2. use the exact Node 24.19.0 fnm path;
3. run only the requested local gates/review;
4. not modify implementation unless explicitly permitted;
5. overwrite `docs/verification/gemini/LATEST.md` with Tested commit, environment, commands, findings and PASS/FAIL;
6. commit/push only the allowed report/generated files.

After PASS, update this ledger only with durable facts. Do not append raw command transcripts or create a permanent file per validation.

## Recovering removed evidence

Use git history instead of restoring duplicate docs into the current tree:

```bash
git log -- docs/verification/gemini
git log -- docs/acceptance
git show <commit>:docs/verification/gemini/<old-report>.md
git show <commit>:docs/acceptance/<old-record>.md
```

This keeps current agent context small while preserving the complete audit trail.
