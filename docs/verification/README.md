# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, fold durable facts here. Older raw reports and superseded acceptance detail remain available through git history; do not recreate dated report files.

## Current validation status

The historical Core/Project Memory foundation re-freeze described below was valid for implementation HEAD `0c7a177d2f4fceab58513cbd0d87fcf9c31b025b`, but it is **not evidence for the current remediation tree**.

An independent audit against official DSH `0.1.2-alpha.1` later found one Core correctness defect and four Project Memory filesystem/cancellation/durability defects. The branch has been changed to remediate them, so Core and Project Memory are currently **REOPENED PENDING FRESH VERIFICATION**.

Do not cite the old `176/176`, `39/39` or workspace `270/270` counts as proof that the current branch passes. New durable evidence belongs here only after a fresh local run on the final remediation HEAD.

## Environment baseline

Accepted local validation baseline:

- Node `v24.19.0` from fnm;
- pnpm `11.21.0`;
- installed DSH `0.1.1-rc.2`;
- Linux/CachyOS;
- GitHub Actions/hosted CI: not used;
- Windows: **NOT TESTED**.

Compatibility work also uses official upstream DSH tag:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Actual upstream source/runtime contracts at that exact tag/commit are primary truth when documentation lags.

## Historical Core acceptance

Core 01–16 were accepted before the latest independent audit.

| Gate | Historical accepted result |
|---|---|
| Core 01 | usage lifecycle/race safety PASS |
| Core 02 | UTF-8 streaming split-chunk decoding PASS |
| Core 03 | canonical provider ids/routes PASS |
| Core 04 | workspace confinement PASS |
| Core 05 | transactional provider registration rollback PASS |
| Core 06 | provider without usage capability remains visible as unsupported PASS |
| Core 07 | browser stale-async lifecycle protection PASS |
| Core 08 | shared `VendorFailure` contract/recognizer PASS |
| Core 09 | direct `dsh-subagent` dependency removed PASS |
| Core 10 | provider-neutral boundary + synthetic fourth-provider extension PASS |
| Core 11 | registry-first root lifecycle/injection PASS |
| Core 12 | direct `dsh-authorization` dependency removed PASS |
| Core 13 | canonical routed Web Search/error taxonomy PASS |
| Core 14 | package/install/real DSH boot/unload-remount acceptance PASS |
| Core 15 | rc.2/alpha.1 Connection + browser-client compatibility PASS |
| Core 16 | non-vetoing registry observers + registration preflight/rollback integrity PASS |

Key checkpoints:

- Core 15 implementation HEAD `59512d51e55f8121eccdb934e01523e4436b289c`, raw report commit `c991bb6ece48acb02d5c15bce3b2b970c3da391a`;
- Core 16 implementation HEAD `b925e2a328168e7c978126fc6474b7af11d7a63d`, raw report commit `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

The later independent audit retained the alpha.1 compatibility conclusions for Connection/browser/LLM/session/subprocess surfaces, but found a Model Accounts storage-failure correctness issue. The remediation now requires fresh focused Core validation before re-freeze.

## Historical Project Memory acceptance

PM01–PM05 were accepted before the latest independent audit.

| Gate | Historical accepted result |
|---|---|
| PM01 | one root policy for context/tools; nested Git/worktree/non-Git cases PASS |
| PM02 | package/workspace + atomic-write + Cordis commands/llm + disposable real DSH boot PASS |
| PM03 | maintenance route selection before prompt assembly; first request uses selected provider/model PASS |
| PM04 | inter-process same-file RMW locking across `MEMORY.md`, topics and `.gitignore` PASS |
| PM05 | named-topic + Memory-map compound preflight/rollback/concurrency integrity PASS |

Key checkpoints:

- PM03 implementation/test through `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`, raw report commit `10020983856a1137f286c83f9ed68c0a62605f58`;
- PM04 implementation HEAD `eae9caf03f8896f344d7c73b2f67d67cb9f86e9c`, raw report commit `02e0dca62f49fc2ef6bba8626ae028c7da3986e2`;
- PM05 implementation HEAD `dbe1b7a3894bc05c1c4863148060bff59166bc17`, raw report commit `8e8c1980a34d6c9b0cbd020f0d0166e7c4c00e01`.

Those gates did not exercise the later-discovered validation/use replacement race, complete-before-visible first publication, abort-during-lock behavior, or process death between compound participant commits. The current remediation adds new storage/recovery contracts and therefore requires a new PM acceptance result rather than extending the old PM05 result by assumption.

## Historical final foundation re-freeze — SUPERSEDED FOR CURRENT HEAD

Historical foundation implementation HEAD:

```text
0c7a177d2f4fceab58513cbd0d87fcf9c31b025b
```

Historical raw PASS report commit:

```text
c209be795601ac7c4a3328c4af6bdbefde7f9f82
```

Historical accepted result at that exact implementation included:

- `pnpm install --frozen-lockfile` PASS;
- Core tests `176/176` PASS;
- Project Memory tests `39/39` PASS;
- full workspace tests `270/270` PASS;
- workspace/package check + build PASS;
- `pnpm verify:local` PASS;
- six rc.3 local tarballs generated;
- packed Core/Project Memory metadata PASS;
- local resolved DSH graph `0.1.1-rc.2`;
- production foundation peers `0.1.1-rc.2 || 0.1.2-alpha.1`;
- official alpha.1 source/runtime compatibility for the then-current seams PASS.

That freeze was subsequently reopened. It must not be projected onto the changed remediation HEAD.

## Current remediation evidence awaiting local acceptance

Source-level changes now present include targeted regressions and implementation for:

- Core credential-store read failure -> safe `ERROR` instead of false absence;
- Core failed durable legacy-grant deletion -> sanitized RPC failure instead of nominal success;
- POSIX directory/file descriptor identity anchoring for Project Memory I/O;
- explicit symlinked project roots with strict package-owned `.dsh` final components;
- complete-before-visible no-clobber first publication;
- AbortSignal-aware lock acquisition and model/lazy-init propagation;
- `pending`/`committed` transaction journal with exact participant pre-images;
- dead pending rollback and committed preserve/cleanup recovery;
- recovery of abandoned pending state after the Memory-map lock barrier even when the old process PID remains alive;
- idempotent concurrent recovery cleanup.

These are implementation facts, **not PASS evidence**. They become accepted only after the current `HANDOFF.md` foundation validation block succeeds.

## Codex accepted pre-work evidence

A stale Codex primary live fixture was repaired and accepted on commit `4c75129a7f766d415182441d91ed1e8e1ca8a50d`.

Accepted result at that checkpoint:

- registry-first rc.3 fixture without `subagents`;
- obsolete vendor-specific subagent acceptance removed;
- executable override uses `env.DSH_CODEX_EXECUTABLE`;
- provider `codex` / route `codex-app-server` register successfully;
- Codex tests `31/31` PASS;
- check/build PASS;
- real `test:live:primary` PASS with `gpt-5.6-sol` returning `CODEX_PRIMARY_OK`;
- adapter/process teardown clean.

This evidence is a starting point, not a Codex freeze. Provider-specific work is paused until the foundation is re-frozen.

## Documentation structure

Current rules:

- `docs/HANDOFF.md` owns the immediate next task;
- `docs/ROADMAP.md` owns task order/status;
- `docs/ARCHITECTURE.md` owns current technical contracts;
- `docs/RELEASE.md` owns release/Market state;
- this file owns durable accepted validation;
- `docs/verification/gemini/LATEST.md` is the only rolling raw Gemini report;
- old plans/specs/session summaries/reports remain in git history.

## Current open validation

Ordered open validation is now:

1. Core + Project Memory remediation focused/local/workspace/alpha.1 verification and re-freeze decision.
2. Codex provider cleanup + provider-specific DSH compatibility + focused/local/live freeze acceptance.
3. Antigravity cleanup/catalog + provider-specific compatibility + focused/local/live freeze acceptance.
4. Claude usage-only cleanup + provider-specific compatibility/smoke.
5. Repository-wide provider invariants.
6. Cross-provider/product live acceptance.
7. Final profile/install/release gates.

See `docs/ROADMAP.md` for task status and `docs/HANDOFF.md` for the immediate next run.

## Validation workflow

For each issue Gemini should:

1. pull the current branch;
2. use the exact Node `24.19.0` fnm path;
3. run only the requested local gates/review;
4. not modify implementation unless explicitly permitted;
5. overwrite `docs/verification/gemini/LATEST.md` with tested commit, environment, commands, findings and PASS/FAIL;
6. commit/push only the explicitly allowed files.

After PASS, update this ledger only with durable facts. Do not append raw command transcripts or create permanent per-run report files.
