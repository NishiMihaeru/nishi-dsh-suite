# rc.3 branch quality review

Not canonical. This file records a 2026-09-04 maintainability review of `feat/core-provider-plugins-rc3` at `b660ff7` versus `origin/main`. Architecture stays in `ARCHITECTURE.md`. Task order stays in `ROADMAP.md`.

Two later addenda live at the bottom and are not the review:

- live-session forensics from exported DSH logs;
- the Codex-then-Antigravity bugfix queue that followed those logs.

The review itself does not approve the branch. Correct behaviour and green tests are not the bar. The bar is whether the change made the tree simpler to hold in one head.

Scope of the review: 335 files, +36211 / −17250. Source-only (excluding docs, tests, lockfile): +13378 / −8911. Working tree was clean; comparison is merge-base with `origin/main`.

---

## Verdict

Do not land this as a quality freeze.

The Core inversion is the right architecture: a provider is a descriptor, Core names no vendor, capability absence is data, Claude-as-usage-only is the honest test of that contract. Deleting Model Accounts, vendor subagent/delegation, and the parked Codex transport removed whole classes of complexity. `VendorFailure` (no raw stderr) and transactional rollback of Core-owned state are real contracts.

The branch then dumped the actual protocol work into two adapter files that crossed 1k lines, a filesystem kernel one commit from the same fate, and leftover wrappers the new package was supposed to delete. A fourth coding-CLI provider will be another 1.5k-line translation, not a YAML row. That is acceptable as a product cost. It is not acceptable as “the adapters just grew a bit.”

## What is actually good

So the rest is not misread as “throw it out”:

- `registerProvider` + optional `model` / `webSearch` / `usage` is the correct seam. Claude with only usage proves the contract.
- Composition no longer names vendors. Routed search does not fall back across providers. `UNSUPPORTED` is a roster row, not an error.
- Outer Core `inject: []` plus child `nishi-core-host` correctly avoids Cordis self-injection.
- Antigravity already extracted `schema-transport.ts`, `agy-session.ts`, `agy-vendor.ts`. Codex already extracted `stepped-schema.ts` and `history.ts`. That grain is what to copy, not a new framework.
- Rebuild from DSH history rather than patching the vendor. Prefix digest includes content (and, for Antigravity, `source`). Turn stamps exist because `structured_output` sticks. Auxiliary requests are isolated. `assertExecutableDecision` runs before any yield.
- Project Memory pinning, generation-checked directory locks, WAL `pending`/`committed`, and `forSettlement()` (drop the caller signal after a durable write) are the audit’s payload. Keep them.

## File size (presumptive blockers)

| File | Before | After |
|---|---|---|
| `packages/antigravity/src/antigravity-primary.ts` | 787 | **1610** |
| `packages/codex/src/codex-plugin-dsh/adapter.ts` | 837 | **1375** |
| `packages/project-memory/src/filesystem.ts` | 72 | **974** |

Tests that also crossed 1k (lower priority than production): `session-reuse.test.ts` 1107, `stepped-schema.test.ts` 1061, `stepped-transport.test.ts` 1022.

The new work is real (persistent `agy` child, Codex resume/rollback/fork, pinned FS + WAL). It landed in the wrong compilation units.

**Antigravity.** `AntigravityCliAdapter` shares a file with catalog parsing, envelope serialization, settlement taxonomy, usage differencing, and the conversation state machine. Tests already split that way (`model-catalog`, `session-reuse`, `turn-settlement`). Extract those modules. The remaining judo is a conversation manager: `runTurnBody` (~1459) is implicit-state soup (live vs throwaway, full vs delta, empty-unheard recurse, signature/prefix mismatch, in-flight, idle, abandon-after-reject). Recursing on itself to rebuild is a named transition pretending to be a retry. `stream()` itself is the one all-or-nothing sequence and should stay together.

**Codex.** `stream()` is a 286-line `for (;;)` over notifications. `startTurn` is a 196-line resume/rollback/fork tree. `isolationConfig` is a 90-line feature-kill object. Windows argv lives in the LLM adapter, so the search backend imports it. Extract `invocation.ts`, `isolation.ts`, `turn-stream.ts`. Do not invent a shared “vendor session” with Antigravity: Codex continues a `threadId`, Antigravity continues stdin lines.

**Project Memory.** `createDirectoryScope` (~426, ~410 lines) mixes generic file ops with the writer-lock protocol. Error strings already say `"Project memory writer lock"`. Split lock protocol from directory scope. This file must not cross 1k on the next audit finding.

## Findings

Prioritized. Presumptive blockers unless justified.

### 1. Windows `.cmd` wrapping still lives in two providers

`packages/antigravity/src/agy-vendor.ts` already records that Codex applied the shim on one spawn path and not the other. This branch reimplemented it again:

- Antigravity: `resolveVendorInvocation`
- Codex adapter: `codexWindowsBatchShimInvocation`
- Codex search imports the adapter for argv
- Codex **usage-source bypasses it** (`codexAppServerArgv` = `[executable, 'app-server', '--stdio']`)

`nishi-dsh-core/runtime` already owns `resolveVendorExecutable`. The next helper is: wrap a resolved `.cmd`/`.bat` so untrusted text never sits in a `cmd.exe` tail. One function, env-var name parameterized, optional trailing placeholder for search prompts. Then delete the copies.

Same miss, smaller: `combinedSignal` is copy-pasted in both adapters and Codex search.

Codex `apply` also skips the shared resolver on the hot path (`externalCodexCommand`). That drops PATH walk, win32 `.exe`, and fail-closed executability. `packages/codex/src/resolver.ts` is a wrapper that casts `'config'` out of `source` and is not what `apply` calls.

### 2. Core still carries the previous host

**`credentials` is still injected** after Model Accounts was deleted (`packages/core/src/index.ts` host plugin `inject: ['nishiProviders', 'connection', 'credentials']`). Nothing in `packages/core/src` reads `credentials`. A ghost inject delays host mount and is locked in by `root-inject.test.ts`. Delete it.

**`registerConnectionRpcChannel` is `rpc.handle(channel, handler)`.** The rc.2 arity probe is dead. A named seam that only documents “do not double-own the disposer” is a comment, not a function.

**`vendorFailure()` is `return new VendorFailure(spec)`.** Same.

**`ProviderDescriptor.executable` is required and never read** by `registerProvider` or the registry. **`RegisteredProvider.descriptor` is stored as `as ProviderDescriptor<never>`** and never read after `record`. The factories have already run. Keeping them is a type hole plus retained closures.

**`SharedProviderConfig` is six always-on fields.** Claude is usage-only and still maps `usageRequestTimeoutMs` onto both `catalogTimeoutMs` and `turnTimeoutMs` so it can satisfy `Required<>`. Core never uses those fields for Claude. Shared config should be a partial overlay.

**Registration announces before it is committed.** `registry.record()` calls `#announce()` immediately, then the LLM adapter and `install` run. Usage composition can register a collector against a provider whose adapter is not live yet. `record` should be private to the transaction; observers see a fully wired provider or nothing.

**Usage is four hops for one roster row:** `UsageLimitsService` → `PublicFacade` → `UsageLimitsHostService` → RPC. The host reimplements `UNSUPPORTED` in `index.ts`. `composeUsageLimitsHost` takes `config.clock` **and** a third `clock` argument and ignores `config.clock`. `parseUsageSnapshotCollector` runs in `registerProvider` and again in `UsageLimitsService.register`.

**`runtime/index.ts` re-exports** the registry, `NishiProvidersService`, and web-search types. Providers should need `registerProvider`, descriptor types, and vendor helpers.

**`assertPlainObject` / percent / decimal** are copied in all three provider `usage.ts` files. Core’s usage contract already owns this.

### 3. Feature logic leaked into the shared presentation contract

`ProviderPresentation.bucketsAsPools` is set only by Antigravity. The client branches on it (`usage-group-model.ts`) and hardcodes `'5h'` / `'Weekly'` for `SHORT`/`WEEKLY`. The comment says pool identity comes from the normalizer — then a boolean teaches the browser a vendor layout.

If `scope.kind === 'BUCKET'` windows carry `id`/`label`, always render pools. Otherwise fold. No vendor flag on the Core contract.

### 4. Codex `stream` is spaghetti; the history bridge is a monkey-patch

`installCodexPrimaryHistoryBridge` patches `CodexAppServerAdapter.prototype.stream` through `Symbol.for`, an owner count, and `as unknown as CodexAdapterPrototype`. The work is `projectCodexPrimaryHistory(options)` at the top of `stream()`. Call it there. Delete the bridge state machine.

Inside `stream()`:

- Six finish sites copy usage + `replayState` (and disagree on auxiliary). One `emitFinish`.
- `recordValue()` returned `{}` on a malformed object. Skills discovery throws; MCP servers and apps **silently stayed enabled**. Isolation was fail-open on the path whose job is “vendor tools off.” *(First Codex bugfix; see addendum.)*
- Non-string deltas became `''`. *(First Codex bugfix.)*
- `willRetry === true` was ignored with no budget; the turn waited until `turnTimeoutMs`. *(First Codex bugfix.)*

The isolation kill-list is duplicated as JSON (`adapter.ts` `isolationConfig`) and as `-c` argv (`web-search-backend.ts`), already drifting on `image_generation`. One table, two renderers.

Usage-source reimplements App Server JSON-RPC instead of `CodexAppServerConnection`. Third spawn path, the one without the Windows shim.

`ActiveTurnQueue` in the adapter is `NotificationQueue` in `app-server.ts` with `next(signal)`. One class.

### 5. Antigravity still has a growing denylist and a cloned stream-json client

`BLOCKED_NATIVE_TOOLS` is a finite denylist against an open vendor registry, inspected **after** the CLI already ran the tool. Agent markdown allowlists `finish`. `--sandbox` is on every spawn. Fail closed on any native tool other than `finish` (primary) / `{search_web, finish}` (search). `nativeToolNames` already returns every name.

`web-search-backend.ts` reimplements the readline/`result` loop that `AgyTurnProcess` already is, plus a second `structuredResult` that ignores turn stamps. Search is one `AgyTurnProcess.turn()`.

`quotaHarvestCache?` on the adapter constructor exists so unit tests can construct the class without a cache. Tests should go through `createAntigravityPrimaryAdapter` or take a no-op cache.

`usage-source.ts` still has `let list: any[]`, `payload: any`, and `rejectUnauthorized = false` on the loopback harvest `stream()` feeds. The machine-wide scan is gone; the comments and `any` are not. `quota-harvest-cache.ts` module docs still describe the deleted scan.

Dual concurrency guards: `turnsInFlight` on the adapter and `AgyTurnProcess.busy`. One session lease; `busy` becomes an assertion.

Cold harvest / session close ignore `disposeVendorChild` from Core; Codex and Claude already call it.

`sentDigests` is committed in `runTurnBody` before `stream()` validates the decision (blocked native tool, stale stamp, unexecutable). Non-atomic: abandon is recovery, not the default. A `TurnRun` that stays uncommitted until validation would make abandon the default.

### 6. Project Memory protocol is right. File boundaries are not

Keep descriptor pinning, generation-checked directory locks, WAL phases, `forSettlement()`.

Delete duplicated choreography:

- `settleCommitted…` and `settlePendingUnderMemoryBarrier` are the same algorithm;
- `writeTopicMemoryWithMap` / `editTopicMemoryWithMap` are the same WAL with a different mutate;
- recovery runs in topic functions **and again** inside `withMemoryMapEntryTransaction`.

`error: any` appears ~16 times in `filesystem.ts` for errno checks. One `isErrno(error, code)` on `NodeJS.ErrnoException`. Test-only hooks (`testOnlyAfterDescriptorStatHook`, `testOnlyPreClaimReadHook`) sit on production types; hide them.

Do not replace directory locks with flock. Do not collapse pending/committed.

Suggested split: `fs/identity.ts`, `fs/directory-scope.ts`, `fs/writer-lock.ts`, `transaction/journal.ts`, `transaction/recover.ts`, one `withJournaledTopicMutation`.

### Code judo (delete a category, don’t relocate it)

- Make `AgyTurnProcess` the only stream-json client; delete search’s private event loop.
- Do not invent a shared session-reuse core between Codex and Antigravity.
- Fail closed on unexpected native tools; delete `BLOCKED_NATIVE_TOOLS` as a changelog.
- Call `projectCodexPrimaryHistory` inside `stream()`; delete prototype patching.
- One invocation module; stop search/usage deriving argv.
- Drive usage-source through `CodexAppServerConnection`.
- One Codex feature-flag table, rendered as JSON config and as `-c` argv.
- `emitFinish` for the six yield clusters.
- One abortable notification queue shared with `app-server.ts`.
- `object()` / `optionalObject()` instead of `recordValue()` for isolation inputs.
- Lift Windows shim next to `resolveVendorExecutable`.
- Delete `registerConnectionRpcChannel`, `vendorFailure()`, `credentials` inject, stored `descriptor`/`executable`, `bucketsAsPools`.
- `SharedProviderConfig` as a partial overlay.
- Recover Project Memory once at the domain edge.

## Approval bar

**No.** The plugin contract is clean enough to implement against. The branch still:

- pushes two adapters past 1k and leaves filesystem at 974;
- duplicates the Windows shim the comments say already bit this suite;
- leaves `credentials`, connection-compat, and a six-field shared config after the features that justified them died;
- patches a prototype instead of calling a function;
- (before the first Codex cut) fail-opened isolation through `recordValue({})`;
- teaches the browser an Antigravity boolean.

Decompose the three large files, lift the Windows shim into Core, delete the ghost host surface, and replace the prototype patch with a direct call. Then the architecture matches the README.

---

## Addendum A — live session forensics (2026-09-03 night)

Not part of the quality review. Two exported sessions, same user prompt (what changed between `dsh-v0.1.2-alpha.1` and `dsh-v0.1.2-rc.1`). Zip files `dsh-session-session-*.zip` in the repository root; gitignored; do not commit.

### Codex `session-0c538d8a-e17e-42c5-a70c-ab6922471230`

Orchestrator preset, `codex-app-server` / `gpt-5.6-sol` **high**. Not one model turn. One user request, 27 minutes (23:28–23:56):

| | |
|---|---|
| Parent steps | 52 |
| Subagent sessions in the zip | 9 (depth 1 → 2 → 3) |
| `subagent` tool calls in the tree | 20, **none passed `model`** |
| Total steps | **812** |
| Total tool calls | **797** |

Every child also ran `gpt-5.6-sol:high`. The allowlist offers `gpt-5.6-luna`, MiniMax, bonsai, Gemini flash, Opus. Inheritance of the parent route is what hit the ChatGPT 5h window. Subscription limits are message-weighted; prompt-cache savings do not automatically save that counter (`ROADMAP.md`).

Cascade: parent spawned two background audits → those spawned more → those spawned more. By 23:36 several `sol high` App Servers were reading the same alpha/rc diff in parallel.

Then three hits:

1. **23:37** parent asked approval to escalate sandbox for `npm view` (home npm cache). Allowed at **23:56** — **19 minutes**. The vendor turn was **parked**. Turn 1 ended:

   `the vendor turn failed while a dynamic tool call was still parked, so the model proceeded without ever receiving its result`

   That string is **gone from this tree**. The nightly run was still on the parked transport. Measured earlier: while a call is parked the vendor bills roughly every 30s. Nineteen minutes of waiting on Allow is tens of 5h hits with no work, on top of the live children.

2. **~23:40** eight of nine children died on the same `CODEX_APP_SERVER` / `unrecognized` fatal (`stage: app-server-notification`). One child (web research, 22 steps) completed. That is the vendor closing processes (quota/limit), not nine independent bugs. The recognizer list has login, `auth.json` EACCES, and network errno — not rate-limit — so exhaustion surfaces as `unrecognized`. Do not invent a pattern without a captured vendor string; the next live hit should record `params.error` **off the diagnostic path** before adding a recognizer.

3. After Allow, the parent failed on the parked call. The follow-up user turn died in 2s with the same unrecognized App Server fatal — the process was already dead.

### Antigravity `session-5cf44631-c1d7-4f47-b491-270231e87841`

`antigravity-cli` / `gemini-3.8-flash` **high**, 2.5 minutes, no subagents.

Turn 1 steps 1–6 succeeded (`todo_write`, `bash`, `create_goal`). Step 7:

`ANTIGRAVITY_STALE_DECISION` — reply stamped `86e9e690` (previous step) instead of `85bf7f55`.

Documented: `structured_output` sticks; a turn with no new JSON reuses the last decision. The adapter correctly refused to re-execute those tools. It also **abandoned the live `agy` child**, which is the session-killer.

Turn 2 (user mash): `ANTIGRAVITY_CLI` / `unrecognized` / status `ERROR`. New or already-dead child, no usable settlement.

---

## Addendum B — bugfix queue after the logs

Decided with the maintainer: Codex first, then Antigravity. Decomposition of 1k-line files is not the first cut. Parked-call abandonment is already deleted on this branch (stepped transport). Do not reintroduce a spanning vendor turn.

### Codex

1. [x] Isolation fail-closed on shapeless `config/read` / `mcp_servers` / `apps` (same standard as `skills/list`).
2. [x] Non-string agent-message deltas fail the protocol instead of becoming `''`.
3. [x] Bound `willRetry`: ignore at most two retrying errors; the third fails the turn instead of sitting until `turnTimeoutMs`.
4. [x] Drive usage-source through `codexAppServerInvocation` + `CodexAppServerConnection`.
5. [x] Replace the prototype history patch with a direct call in `stream()`.
   Turn timeout also keeps a referenced timer (`AbortSignal.timeout` is unref'd and never fired in a quiet event loop); closing the turn aborts it.
6. Capture the next live App Server `error` payload (not in user diagnostics) and add a rate-limit recognizer only if the wording is stable.
7. [x] Spawned/forked children cannot re-delegate: Orchestrator `subagent` and `subagent_fork` set `maxDepth: 1`.
8. Empty `subagent()` still inherits the parent route when the allowlist is on. That skip is inside stock DSH (`assertAllowedModelSelection` returns before checking the list). Suite config cannot close it without forking DSH.

### Antigravity

1. [x] Stale decision: fail the step; do not kill a healthy child that still agrees with the prefix. Rebuild only when the child is dead or the prefix no longer matches.
2. [x] Fail closed on unexpected native tools (drop the growing denylist).
3. [x] Search uses `AgyTurnProcess`, not a second stream-json client.
4. [x] Harvest cache is required at the factory; tests use a no-op.

### Later (the review’s own remedies, not this bugfix slice)

Decompose the two adapters and `filesystem.ts`. Lift the Windows shim into `nishi-dsh-core/runtime`. Delete `credentials` inject, `registerConnectionRpcChannel`, stored `descriptor`/`executable` on the live registry, and `bucketsAsPools`. Make `SharedProviderConfig` a partial overlay.
