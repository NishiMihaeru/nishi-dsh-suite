# Handoff

Updated for `0.1.0-rc.3` after a follow-up audit of Core, Project Memory and Codex that reproduced defects in all three, the remediation of those defects, a local re-validation of the remediated tree that failed on a further Project Memory defect, and the fix for that defect. The local gate is now green; independent validation, alpha.1 probes and Codex live acceptance are still missing.

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

`0.1.1-rc.2` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence. `docs/README.md` owns that policy.

The Foundation dev/test baseline has moved to alpha.1 and the whole workspace is green on it. The declared peer range has **not** moved — upstream has not published alpha.1 to npm, so an alpha.1-only range would be uninstallable for consumers. That narrowing, and removing the rc2/alpha `Function.length` shim with it, stays gated in `ROADMAP.md` §7b. Provider packages keep rc.2 peers and do not inherit Foundation alpha.1 compatibility automatically.

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

### Local gate on this tree — PASS after one fix

Local re-validation first ran at HEAD `7039913` and **failed**: `pnpm verify:local` gave FAIL, PASS, PASS over three consecutive runs on a load-sensitive Project Memory recovery read race. That defect is now fixed (see below) and the gate is green.

Evidence on the fixed tree:

| Evidence | Result |
|---|---|
| `pnpm verify:local` x5 | 5/5 exit `0` |
| workspace `build` / `check` / `test` | exit `0`; Core `209`, Project Memory `77`, Codex `61`, Claude `7`, Antigravity `7`, Suite `12` |
| new deterministic race tests x10 | 10/10 exit `0` |

Project Memory went from `72` to `77` tests: five new deterministic regressions, no test removed or weakened.

Pre-fix evidence, retained because it describes what the gate does and does not catch: `pnpm test` x3 all exit `0`; Project Memory full suite x5, `compound-transaction` alone x8, and `compound-transaction` x18 under 6-way process contention all passed. Only the full `verify:local` sequence ever reproduced it. A single green `build`/`check`/`test` is not evidence for this class of defect.

Lock/WAL residue: none created by any of these runs. Three pre-existing `/tmp/dsh-memory-atomic-test-*` directories with `.lock` files predate the work and remain unattributed.

Codex live acceptance is **done and PASS on the alpha.1 baseline**: `pnpm --filter nishi-dsh-codex test:live:acceptance` exits `0`, 9 test cases covering all 15 scenarios, 0 failures, ~66 s, against real `codex-cli 0.150.0` processes. Routed native web search, usage/rate-limits read, cancellation during an active turn and during tool continuation, recovery from a deleted vendor thread, adversarial isolation returning `HOST_CAPABILITIES_ISOLATED`, and zero lingering `app-server --stdio` processes. It was first run and passed on the rc.2 baseline too, before the move.

Still missing before any freeze claim: independent validation, and exact-commit alpha.1 runtime probes.

### The local DSH install is NOT a valid alpha.1 probe environment

This was measured, not assumed. The local setup:

- `.artifacts/upstream/dsh-alpha1` is the exact upstream checkout `cd5ef8148158c3a752a658978873241fdf8e2bbc`, **built** (output in `lib/`, not `dist/`);
- the global `dsh` on PATH reports `0.1.2-alpha.1` and is a symlink into that checkout's `apps/cli/lib/bin.js`;
- the `web` profile links `nishi-dsh-core`, `nishi-dsh-project-memory` and `nishi-dsh-codex` from this working tree. Core and Codex are inserted by `~/.dsh/profiles/web/cordis.patch.yml`; Project Memory is loaded by the Orchestrator agent preset (`~/.dsh/.agent-presets/orchestrator/agent.cordis.yml`), not by the profile patch — both are live.

Despite the alpha.1 host, the linked packages do **not** run against alpha.1. Booting `dsh web` under an ESM resolution hook shows every `@deepseek-ai/dsh-*` import made *by* the linked packages resolving into the workspace rc.2 store — `dsh-agent`, `dsh-credentials`, `dsh-llm`, `dsh-sdk-protocol`, `dsh-timeout`, `dsh-tools`, all `0.1.1-rc.2`. Node resolves from each package's real path, and the DSH loader does not override it: `.dsh-module-fallback/node_modules` is empty and `.package-map.json` gives the linked packages no mapped dependencies.

The running process therefore holds **two copies** of `dsh-tools`, `dsh-llm`, `dsh-agent`, `dsh-timeout` and `dsh-credentials` at once — alpha.1 for the host, rc.2 for the plugins. It works in practice today, but it is mixed-generation by construction, and anything crossing that boundary on module-level identity (symbol-keyed registries, `instanceof`, module singletons) is a latent hazard worth its own look.

Consequence for validation: a probe run on this profile measures the hybrid, not alpha.1, and cannot support an alpha.1 compatibility claim. The probe needs a disposable environment in which the linked packages themselves resolve `@deepseek-ai/dsh-*` to the alpha.1 checkout — which is why the previous cycle used one. Whatever environment is used, build the packages first: the profile loads each package's built `lib/`, so an unbuilt tree measures the previous state.

### Fixed defect — Project Memory recovery read raced a concurrent journal rewrite

`recoverPendingProjectMemoryTransaction` probes the fixed-path journal `.dsh/local/project-memory-transaction.json` *unlocked* before doing anything else. A second live process rewriting that journal atomically in the same window left the post-open `lstat` seeing a different inode, and `readRegularFile` treated every identity change as fail-closed. The bounded re-observe loop that exists for exactly this case never saw it, because the condition was thrown from the filesystem layer instead of returned as `RETRY` — so an unrelated caller's memory operation failed. It violated invariant 25.

The fix splits one condition into two, in `src/filesystem.ts`:

- replacement by a symlink or other non-regular entry keeps the original error and stays fail-closed everywhere;
- replacement by a different *regular* file — the ordinary result of another process's atomic rename — now throws the distinguishable `CanonicalRegularFileReplacedError`.

`recoverPendingProjectMemoryTransaction` catches that error around the unlocked pre-claim read only, feeding the existing `MAX_RECOVERY_OBSERVATIONS` loop. `claimAndSettleDeadOwner` is untouched: reads after this process has durably claimed the journal still fail closed on any change, including the new error type.

`SafeReadOptions` gained a documented test-only hook fired between the descriptor `stat()` and the pathname `lstat()`, so the regression is deterministic rather than load-dependent. No production call site sets it, and the hook does not cross the package's public boundary — `recoverPendingProjectMemoryTransaction` is not exported from `src/index.ts`.

Coverage added: benign regular-file replacement re-observes and the caller still succeeds; symlink and directory replacement both still fail closed and are asserted *not* to be the new error type; endless churn stops at the observation bound with the journal intact.

Invariants 24 and 25 in `ARCHITECTURE.md` and the Project Memory README were updated to state the sharper distinction.

## Immediate task — finish the validation the fix unblocks

1. run an independent validation of Core, Project Memory and Codex against this tree;
2. produce the evidence still missing: exact-commit alpha.1 runtime probes and Codex live acceptance, using the wired environment above — build the linked packages first;
3. only then fold durable evidence into `docs/verification/README.md` and restore a freeze claim.


`packages/antigravity` no longer builds diagnostics from raw vendor output. All four sites — the two in `web-search-backend.ts`, model discovery and the turn close handler in `antigravity-primary.ts` — go through `antigravityVendorFailure` in `packages/antigravity/src/vendor-stderr.ts`, mirroring the Codex module. The recognizer list has two entries: platform errno tokens, and the one agy wording confirmed against the real CLI. Everything else reports `unrecognized` with exit/signal only, which is deliberate: agy's wording for login and credential failures is unverified, and a guessed recognizer produces a confidently wrong diagnostic.

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
