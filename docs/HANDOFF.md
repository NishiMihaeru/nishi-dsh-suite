# Handoff

Updated for `0.1.0-rc.3` after a follow-up audit of Core, Project Memory and Codex that reproduced defects in all three, and the remediation of those defects.

Core, Project Memory and Codex are **THAWED** — the previously accepted freeze no longer describes this tree. Each needs its own validation run before a freeze claim is restored. The Antigravity provider stage is unchanged and still queued behind that.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`, unpublished.

Last accepted Foundation implementation HEAD, now superseded by uncommitted work in this tree:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Its raw PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Both are history, not a description of the working tree. Do not cite either as evidence for the current implementation.

Authoritative Foundation DSH compatibility target accepted by the run:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Local package devDependencies remain rc.2; provider packages do not inherit Foundation alpha.1 compatibility automatically.

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
- the writer-lock wait budget moved from 2 s to 10 s, sized for what the holder actually does under one lock, and became overridable per scope via `lockWaitMs`.

One previously documented invariant was deliberately weakened: pre-claim owner transfer no longer fails closed, it re-observes. The safety property behind it is intact — a journal is still claimed only after a lock-held read proves its owner dead. `docs/ARCHITECTURE.md` and the package README were updated accordingly.

### Codex — THAWED

Fixed in this pass:

- **privacy**: raw vendor stderr reached the `web_search` tool error and an unexpected App Server exit diagnostic, and from there the model and the user — home paths included. Every vendor-process diagnostic now goes through Core's `VendorFailure` contract with an authored recognizer list. This also makes Codex the first consumer of that contract, which until now was exported by Core and used by nobody;
- native search verified the vendor runtime by starting a throwaway App Server per query; a four-query `web_search` meant eight Codex processes. Verification is now cached per resolved executable and shared across concurrent queries;
- a Codex CLI outside the audited `0.150.0` now reports `UNAVAILABLE` instead of collapsing to `ERROR`;
- the Windows batch shim is applied consistently to `codex exec`, not only to the app-server path;
- cleanup failure no longer replaces the real diagnostic;
- a fatal `error` notification without a `threadId` fails the turn immediately instead of hanging until the 10-minute turn timeout.

### Local gate on this tree

Workspace `build`, `check` and `test` all exit `0`: Core `209`, Project Memory `72`, Codex `61`, Claude `7`, Antigravity `7`, Suite `12`.

This is a local gate, not an acceptance. No independent validation, no live acceptance run, and no disposable alpha.1 runtime probe has been repeated against this tree.

## Immediate task — re-validate the thawed packages

The audit remediation is implemented and locally green, but nothing independent has looked at it. Before anything else:

1. run an independent validation of Core, Project Memory and Codex against this tree;
2. repeat the evidence the old acceptance rested on and that this pass did not reproduce: `pnpm verify:local`, repeated runs of the Project Memory concurrency/recovery suites, lock/WAL residue checks, atomic-write lock interoperability, disposable exact-commit alpha.1 runtime probes, and Codex live acceptance;
3. only then fold durable evidence into `docs/verification/README.md` and restore a freeze claim.

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
