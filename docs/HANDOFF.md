# Handoff

Updated for `0.1.0-rc.3` after the independent Core + Project Memory audit, remediation, first Gemini FAIL, narrow Project Memory follow-up fixes, and accepted follow-up Gemini PASS.

Foundation is now **FROZEN** again. The next active development stage is **Codex provider-specific audit/cleanup and freeze acceptance**.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`, unpublished.

Accepted Foundation implementation HEAD:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw follow-up Gemini PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

The report commit changes only `docs/verification/gemini/LATEST.md`; comparison to the tested implementation contains no code changes.

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

## Accepted Foundation state

### Core — FROZEN

Accepted remediation includes:

- fail-closed legacy-grant handling; no unsafe credential read-kind-then-delete mutation;
- generation-aware authoritative Usage invalidation;
- browser reconciliation that drops invalidated local `FRESH` state;
- exact alpha.1 Connection/auth/usage runtime probes;
- Core focused tests `182/182`, check/build PASS on the accepted implementation.

### Project Memory — FROZEN

Accepted remediation includes:

- transaction generation identity preventing old cleanup from deleting the next journal generation;
- populated directory writer locks with token/process identity and conditional generation-safe removal;
- PID-reuse hardening on Linux/macOS;
- bounded bootstrap ingestion before whole-file materialization;
- `0600` journal phase replacement on POSIX;
- domain-owned recovery with duplicate tool-layer recovery removed;
- lock publication collision handling scoped to `rename()` without racy structural-collision re-stat;
- concurrent opened-journal unlink treated as current absence while replacement inode/symlink still fails closed;
- legacy transaction generation separated from mutable owner identity.

Project Memory focused tests `64/64`, check/build, full workspace gates and `verify:local` were recorded PASS. The three previously failing concurrency/recovery suites were repeated 20 times with zero failed iterations. The accepted report also records zero unexpected lock/WAL residue and bidirectional `@deepseek-ai/dsh-atomic-write` interoperability.

### Codex — FROZEN

Independent from-scratch audit, remediation, and live acceptance testing completed:

- official Codex `0.150.0` runtime compatibility validated;
- deprecated web search and code-mode feature flags removed;
- stream error on concurrent connection close resolved;
- all 15 live acceptance scenarios passed;
- focused tests `48/48`, check/build, full workspace gates and `verify:local` PASS;
- zero process residue verified.

## Immediate task — Antigravity provider stage

Do not reopen or refactor Foundation or Codex unless Antigravity work exposes a concrete defect with reproduction/evidence.

For `packages/antigravity`, independently inspect current source/tests and the exact DSH/provider runtime seams it actually uses.

Required direction:

1. establish the current Antigravity package/runtime baseline from source, tests and package manifest;
2. audit DSH compatibility for Antigravity primary and subagent providers;
3. remove hardcoded model-family catalog filtering while preserving malformed-entry rejection;
4. verify model-list parser and catalog coverage;
5. verify native web search backend and usage source;
6. run focused test/check/build and live acceptance (primary turn, model switch, routed search);
7. after fresh PASS evidence, mark Antigravity frozen.

## Architectural simplification boundary

Foundation simplifications already accepted:

- duplicate Project Memory tool-layer recovery removed;
- implicit lock/transaction PID/path ownership replaced by explicit generations.

Foundation items intentionally retained until their own compatibility boundary changes:

- exported Core authorization begin/submit/cancel/polling client state machine;
- rc2/alpha Connection `Function.length` compatibility shim;
- usage invalidation generation token;
- fixed Project Memory journal pathname with explicit generation identity.

Do not perform aesthetic Foundation cleanup during Codex work.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Do not reintroduce destructive legacy credential deletion without a reviewed atomic-safe credential contract.
- Read command exit codes directly; avoid pipelines that mask failures.
- Windows remains **NOT TESTED**.
