# Handoff

Rewritten for a fresh session at HEAD `28883af`. It describes the tree as it is now, not the audit narrative it grew out of — that history lives in git and in `docs/verification/README.md`.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

```text
feat/core-provider-plugins-rc3
```

Six packages at `0.1.0-rc.3`, unpublished. Working tree clean, branch in sync with origin.

Only supported DSH generation:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

`0.1.1-rc.2` and earlier are **not supported**. Every declared peer, the dev graph and the whole test suite say exactly that. `docs/README.md` owns the policy and the *Local setup* note explaining why `pnpm install` needs the local upstream checkout.

Windows: **NOT TESTED**. No publish, merge, tag or release is authorized.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests
7. `docs/verification/README.md` when exact accepted evidence matters

`docs/verification/gemini/LATEST.md` is the rolling raw report, not the durable ledger.

## Where the packages stand

All four thawed packages are **THAWED, PENDING INDEPENDENT VALIDATION**. Nothing here is frozen, and the only thing standing between this tree and a freeze claim is a validator who did not write the code.

| Package | State |
|---|---|
| Core | remediated; Model Accounts surface removed outright; 182 tests |
| Project Memory | recovery read race fixed with deterministic coverage; 77 tests |
| Codex | provider audit done, thread handling redesigned, live acceptance passing; 78 tests |
| Antigravity | provider stage complete except the freeze; 62 tests |
| Claude | usage-only stub, unchanged; 6 tests |
| Suite | unchanged; 12 tests |

## Evidence on this tree

- `pnpm verify:local` exits `0` on three consecutive runs;
- Codex live: primary, the full 15-scenario acceptance suite, `test:live:web-search` and `test:live:web-search-routed` all pass. The two web-search suites need `DSH_LIVE_CODEX_SEARCH_MODEL` set and fail a **precondition assertion** without it — a harness prerequisite, not a product defect. Do not read that exit code as a regression;
- Antigravity live: primary (8 scenarios), native search and routed search all pass, against real `agy 1.1.22`;
- an adversarial code review and a documentation audit were run over the whole change set. Both found real defects; all are fixed.

A green gate plus live suites is **not** an acceptance. See *What remains*.

## What was done

Ordered by how much it changes the contract.

- **DSH baseline moved to alpha.1 everywhere** (`2ae63bc`). Every peer range, the dev graph, `DSH_COMPATIBILITY_VERSION` and the contract-verifying scripts. Removed with it: the rc2/alpha `Function.length` arity probe and Core's two retired rc.2 dev fixtures. Two real incompatibilities surfaced and were fixed — `CallId` renamed to `ToolCallId` in `dsh-llm`, and `Context.slots` moving from `dsh-client-ui-slots` to `dsh-client-ui-renderer/client`.
- **Model Accounts removed from Core** (`a8b44fa`), together with the provider-declared `account` capability and its declarations in Codex and Claude. Removed rather than disabled. No Core path reads or mutates a vendor credential record any more.
- **Codex thread handling redesigned** (`79fa972`). An ordinary turn resumes instead of forking; rollback realigns on divergence; fork is kept only for a checkpoint that is neither the tip nor an ancestor. Motivated by measurement, not taste — see *Codex vendor threads* in `ARCHITECTURE.md`.
- **Project Memory recovery read race fixed** (`e38ce06`). A benign concurrent journal rewrite failed an unrelated caller's memory operation. Found only because `pnpm verify:local` was run repeatedly; a single pass stayed green throughout.
- **Vendor-authored text no longer reaches the model or the user** anywhere in the suite. Antigravity gained `antigravityVendorFailure`; Codex's remaining two sites were closed, one of them only after a review caught that a commit had already declared the work finished.
- **Antigravity provider stage**: audit, 7 → 62 tests, catalog parsing rewritten against the format the vendor really emits, vendor sandbox flag added, intra-package duplication removed, usage harvested from the provider's own turn process.
- **Codex no longer fails a turn over a context block it cannot carry** (issue #4). A stopped subagent's settlement notice quotes the interrupted child's terminal output, `tool-call` blocks included, into a `user` message. The plugin rejected those blocks, which killed the live turn and — with no checkpoint written — every later replay of that session. They are now projected to text on the transient request; durable history is untouched. Covered by focused tests only: it landed after the Codex live acceptance run above.
- **Web search left as it is, deliberately.** The investigation found the suite already routes search through the session's live primary model — the concern that prompted it was unfounded. What did change: search results now carry an untrusted-content notice (`81ca500`), which they previously did not.

## What remains

1. **Independent validation, then freeze.** This is the only blocker for all four packages. Everything below is optional next to it. The reason to insist: two reviews that were deliberately not told the author's reasoning each found defects the author's own green test runs had missed.
2. **`thread/inject_items` is unverified.** The call succeeds but its effect is invisible through both `thread/read` and `thread/resume`, so nothing has confirmed it reaches the model. The Codex adapter depends on it for history that follows a checkpoint. Closing this needs one live turn.
3. **alpha.1 runtime probe as separate evidence.** It has effectively dissolved into the ordinary test run now that the whole workspace builds and tests against alpha.1, but it has not been repeated as a distinct artifact.
4. **Suite preset bridge may be obsolete.** It exists to work around an rc.2 launcher bug that overwrites third-party preset roots. Nobody has checked whether alpha.1 still has that bug. If it does not, remove the bridge rather than carry it.
5. **Accepted debts**, recorded with reasoning and revisit conditions in `ROADMAP.md` §3: no vendor version verification for Antigravity, and the `usage-source.ts` loopback TLS trust model.
6. **Blocked on upstream**: publishing `0.1.2-alpha.1` to npm. Until then the declared ranges are uninstallable from the registry, which gates publication rather than development, and the local-checkout overrides stay.

Decided and closed, so nobody reopens them: old vendor threads already in the user's Codex account are not being cleaned up; web search keeps routing through the session's primary model.

## Working notes that cost real time to learn

- Node 24 is not on `PATH`; it lives in fnm. Prefix commands with `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`.
- Read exit codes from `$?` directly. A background wrapper's exit code is not the command's, and a pipeline hides the failure — this cost a false "green" once already this cycle.
- Live suites spend the maintainer's real vendor quota. Ask before running them in bulk.
- Core's `tsdown` build is not reproducible: two builds of an unchanged tree differ in CSS-module key order, so byte-level artifact comparison proves nothing.
- Reading source is not enough for vendor behaviour. Three conclusions drawn from code alone were wrong this cycle and only a live run corrected them.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Do not reintroduce destructive legacy credential deletion, or any Core credential-mutation surface, without a reviewed atomic-safe credential contract.
- Read command exit codes directly; avoid pipelines that mask failures.
- Windows remains **NOT TESTED**.
