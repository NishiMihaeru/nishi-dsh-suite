# Handoff

Updated for `0.1.0-rc.3` after a follow-up audit of Core, Project Memory and Codex that reproduced defects in all three, the remediation of those defects, and a local re-validation of the remediated tree that **failed** on a new Project Memory defect.

Core, Project Memory and Codex are **THAWED** — the previously accepted freeze no longer describes this tree. Each needs its own validation run before a freeze claim is restored. The Antigravity provider stage is unchanged and still queued behind that.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`, unpublished.

Working tree is clean and pushed; current HEAD is `7039913`. The audit remediation described below is committed, not uncommitted work.

Last accepted Foundation implementation HEAD, superseded by the 60 commits since it:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Its raw PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Both are history, not a description of the working tree. Do not cite either as evidence for the current implementation.

Only supported DSH generation:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

`0.1.1-rc.2` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence. `docs/README.md` owns that policy and the list of gaps it does not yet close — upstream has not published alpha.1 to npm, so declared peers and the local devDependency/test baseline are still rc.2, and the rc2/alpha `Function.length` shim is now removal debt. Narrowing those is a published-contract change with its own gate, tracked in `ROADMAP.md` §7b. Provider packages do not inherit Foundation alpha.1 compatibility automatically.

Windows: **NOT TESTED**.

No publish, merge, tag or release is authorized.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests
7. `docs/verification/README.md` when exact accepted evidence matters

`docs/verification/gemini/LATEST.md` is the rolling raw report, not the durable ledger.

## Current state — thawed, pending re-validation

The previously accepted checkpoint was implementation `7cd4d5b17625f9b3a21b741555df6597fd9cb889` with PASS report `d1cbac7094488ded52d9ab83891531bc01197090`. **That evidence does not describe this tree and must not be promoted to it.**

### Core — THAWED

Fixed in this pass:

- capability descriptors (`webSearch`/`usage`/`account`) are shape-checked before their factories run, so a malformed declaration is a named registration error instead of a bare `TypeError`; the rollback boundary is now stated precisely;
- the browser usage controller can no longer strand a rejected in-flight refresh record and permanently stop refreshing a provider, and it now disposes;
- Model Accounts is registry-derived through a new provider-declared `account` capability. The hardcoded `openai-codex`/`anthropic`/`openai` roster, the label table and the fixed credential scope are gone;
- the entire disabled authorization mutation surface was removed rather than kept inert — host endpoints, client state machine, and the secret-typed prompt channel that could only ever end in a refusal.

Visible change: the `openai` Model Accounts row is gone. It was hardcoded, owned by no provider, and always reported an empty `NOT_CONFIGURED`.

Public surface removed from an unpublished package: `READ_PROVIDER_IDS`, `PROVIDER_LABELS`, `MUTATING_PROVIDER_IDS`, `LEGACY_LOGOUT_PROVIDER_IDS`, the begin/submit/cancel/logout endpoint constants and request types, the notice/prompt DTOs, and the corresponding controller methods on both planes.

### Project Memory — THAWED

Fixed in this pass:

- **the reproduced defect**: two callers recovering the same abandoned journal made the loser throw, and the tool layer turned that into a failed memory operation for a completely unrelated topic. Benign pre-claim races now re-observe instead of failing; fail-closed narrowed to mutation of a claim this process already wrote;
- `.dsh/project.json` and `.gitignore` are read under explicit bounds like every other read-modify-write path in the package;
- the writer-lock wait budget moved from 2 s to 10 s, sized for what the holder actually does under one lock, and became overridable per scope via `lockWaitMs`;
- documented explicit topic retirement/removal rules in `DSH.md`, `INITIAL_DSH_MD_CONTENT`, and package README (removing topic file and editing `MEMORY.md` memory map via `memory_edit` without native `memory_delete`).

One previously documented invariant was deliberately weakened: pre-claim owner transfer no longer fails closed, it re-observes. The safety property behind it is intact — a journal is still claimed only after a lock-held read proves its owner dead. `docs/ARCHITECTURE.md` and the package README were updated accordingly.

### Codex — THAWED

Fixed in this pass:

- **privacy**: raw vendor stderr reached the `web_search` tool error and an unexpected App Server exit diagnostic, and from there the model and the user — home paths included. Every vendor-process diagnostic now goes through Core's `VendorFailure` contract with an authored recognizer list. This also makes Codex the first consumer of that contract, which until now was exported by Core and used by nobody;
- native search verified the vendor runtime by starting a throwaway App Server per query; a four-query `web_search` meant eight Codex processes. Verification is now cached per resolved executable and shared across concurrent queries;
- a Codex CLI outside the audited `0.150.0` now reports `UNAVAILABLE` instead of collapsing to `ERROR`;
- the Windows batch shim is applied consistently to `codex exec`, not only to the app-server path;
- cleanup failure no longer replaces the real diagnostic;
- a fatal `error` notification without a `threadId` fails the turn immediately instead of hanging until the 10-minute turn timeout.

### Local gate on this tree — FAIL

Local re-validation at HEAD `7039913` found a defect. `pnpm verify:local` is **not reliably green**: three consecutive runs gave FAIL, PASS, PASS.

What was executed at this HEAD:

| Evidence | Result |
|---|---|
| `pnpm verify:local` x3 | 1 FAIL, 2 PASS |
| `pnpm build` / `check` / `test` | exit `0`; Core `209`, Project Memory `72`, Codex `61`, Claude `7`, Antigravity `7`, Suite `12` |
| `pnpm test` x3 (all packages concurrent) | 3/3 exit `0` |
| Project Memory full suite x5 | 5/5 exit `0` |
| `compound-transaction` + `transaction-recovery` + `atomic-write` + `filesystem-race` x10 | 10/10 exit `0` |
| `compound-transaction` alone x8 | 8/8 exit `0` |
| `compound-transaction` x18 under 6-way process contention | 18/18 exit `0` |
| lock/WAL residue after the above | none created; three pre-existing `/tmp/dsh-memory-atomic-test-*` directories with `.lock` files predate this run and are unattributed |
| upstream `dsh-atomic-write` lock interoperability | PASS (in-suite) |

Not executed, and therefore still missing: independent validation, exact-commit alpha.1 runtime probes, and Codex live acceptance. Running them before the defect below is fixed would only produce evidence for a tree that must change.

The environment for all three is already wired, so none of them needs a fresh build:

- `.artifacts/upstream/dsh-alpha1` is the exact upstream checkout `cd5ef8148158c3a752a658978873241fdf8e2bbc`, **built** (output in `lib/`, not `dist/`);
- the global `dsh` on PATH reports `0.1.2-alpha.1` and is a symlink into that checkout's `apps/cli/lib/bin.js`;
- the `web` profile at `~/.dsh/profiles/web/package.json` links `nishi-dsh-core`, `nishi-dsh-project-memory` and `nishi-dsh-codex` straight from this working tree.

That is a live alpha.1 runtime over the working tree, not a disposable environment. It is the better probe target *and* the sharper hazard: it picks up whatever is in the tree, so a probe run proves nothing unless the tree state it ran against is recorded with it, and editing Foundation source changes the user's running DSH.

### Reproduced defect — Project Memory recovery read races a concurrent journal rewrite

Failing test: `separate processes serialize compound writes through MEMORY.md and preserve every topic/map pair`, `packages/project-memory/test/compound-transaction.test.ts:201`. Rare and load-sensitive: it only appeared under the full `verify:local` sequence, never in ~60 targeted runs including deliberate 6-way contention.

Failure: a `topic-write-map` worker died with

```text
Error: Canonical target at ".../.dsh/local/project-memory-transaction.json" changed while it was being opened
```

from `readRegularFile` (`src/filesystem.ts:589`) via `readPendingTransactionFromScope` -> `readPendingTransaction` -> `recoverPendingProjectMemoryTransaction` (`src/transaction.ts:494`) -> `writeTopicMemoryWithMap`.

Mechanism: `recoverPendingProjectMemoryTransaction` probes the fixed-path journal *unlocked* before doing anything else. A second live process legitimately rewrote that journal atomically in the same window, so the post-open `lstat` saw a different inode. `readRegularFile` already special-cases concurrent unlink (returns `null`) but treats every identity change as fail-closed, conflating two different events:

- replacement by a symlink or non-regular entry — a real security event, must keep failing closed;
- replacement by another regular file — the ordinary, expected result of another process's atomic journal write.

The bounded re-observe loop in `recoverPendingProjectMemoryTransaction` (`MAX_RECOVERY_OBSERVATIONS`) exists for exactly this case but never sees it: the condition is thrown from the filesystem layer instead of returned as `RETRY`, so it escapes the loop and fails an unrelated caller's memory operation.

This violates invariant 25 in `ARCHITECTURE.md` — *a stale pre-claim observation is re-observed, never failed, and never lets an unrelated caller's operation fail* — and sits in the tension invariant 24 leaves open. It is the same defect class as the recovery race remediated in this pass, on the read path the remediation did not cover.

Direction for the fix (not applied):

1. in `readRegularFile`, distinguish benign regular-file replacement from symlink/non-regular replacement, and make the benign case distinguishable to callers rather than a bare `Error`;
2. treat that case as `RETRY` inside the existing observation loop; keep symlink/non-regular replacement fail-closed;
3. add deterministic coverage that rewrites the journal between open and `lstat`, so the regression does not depend on load;
4. re-run the whole local gate from scratch afterwards — the evidence above describes the pre-fix tree only.

## Immediate task — fix the defect above, then re-validate

1. fix the Project Memory recovery read race and land its deterministic regression test;
2. re-run the full local gate on the fixed tree — `pnpm verify:local` repeated enough times to be meaningful, not once;
3. run an independent validation of Core, Project Memory and Codex against that tree;
4. produce the evidence still missing: disposable exact-commit alpha.1 runtime probes and Codex live acceptance;
5. only then fold durable evidence into `docs/verification/README.md` and restore a freeze claim.

Known and deliberately not fixed in this pass: `packages/antigravity` still builds diagnostics from raw vendor stderr — `web-search-backend.ts` around the early-exit branch, and `antigravity-primary.ts` in model discovery (which forwards stderr *or stdout*) and in its collected-run path. This is the same defect class just removed from Codex, and `codexVendorFailure` in `packages/codex/src/codex-plugin-dsh/vendor-stderr.ts` is the working template for the fix.

## Next stage — Antigravity provider stage

For `packages/antigravity`, independently inspect current source/tests and the exact DSH/provider runtime seams it actually uses.

Required direction:

1. establish the current Antigravity package/runtime baseline from source, tests and package manifest;
2. audit DSH compatibility for Antigravity primary and subagent providers;
3. remove hardcoded model-family catalog filtering while preserving malformed-entry rejection;
4. verify model-list parser and catalog coverage;
5. verify native web search backend and usage source;
6. run focused test/check/build and live acceptance (primary turn, model switch, routed search);
7. fix the raw-vendor-stderr diagnostics noted above, following the Codex template;
8. after fresh PASS evidence, mark Antigravity frozen.

## Architectural simplification boundary

Foundation simplifications already accepted:

- duplicate Project Memory tool-layer recovery removed;
- implicit lock/transaction PID/path ownership replaced by explicit generations;
- Core authorization begin/submit/cancel/logout state machine removed on both planes, together with its secret-typed prompt channel. It was previously on the retained list while disabled; a disabled mutation path that still accepts a secret is a liability, not compatibility;
- hardcoded Model Accounts vendor roster replaced by the provider-declared `account` capability.

Foundation items intentionally retained until their own compatibility boundary changes:

- rc2/alpha Connection `Function.length` compatibility shim;
- usage invalidation generation token;
- fixed Project Memory journal pathname with explicit generation identity.

Do not perform aesthetic cleanup while re-validating. Removals in this pass each closed a concrete defect or a concrete liability, not merely shortened code.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Do not reintroduce destructive legacy credential deletion without a reviewed atomic-safe credential contract.
- Read command exit codes directly; avoid pipelines that mask failures.
- Windows remains **NOT TESTED**.
