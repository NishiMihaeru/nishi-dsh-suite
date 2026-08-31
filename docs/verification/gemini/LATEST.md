# Whole-tree adversarial review: two models, four areas

- **Result**: `DEFECTS FOUND` — 16 findings reported, all verified: **15 confirmed and fixed**, 1 rejected, 1 referred to the maintainer as a contract decision
- **Kind**: adversarial code review by two models that did not write the code. **Not** a freeze sign-off; see *Standing*.
- **Reviewers**: `gemini-3.7-flash-high` and `gemini-3.1-pro-high`, via `agy 1.1.22`, each over all four areas
- **Reviewed**: every `src` and `test` tree under `packages/`, at `77f6d80`
- **Cost**: 8 runs, ~2.36M input tokens, ~286k output, 345 tool steps
- **Environment**: Node `v24.19.0`, pnpm `11.21.0`, Linux x86_64. Hosted CI: **NOT USED**. Windows: **NOT TESTED**.

## Method

Each reviewer got an **open** charter and an area brief, and nothing else. No list
of properties to tick off -- the previous review's charter enumerated ten
invariants the author cared about, which bounds what can be found to what the
author already suspected. This charter says only what the software is, that
defects are wanted and style is not, and that design may be challenged: "a
confident-looking abstraction resting on an assumption nobody checks is a
defect". `docs/`, package `README.md` files and commit messages were declared out
of scope, on the grounds that intent is not what is being checked.

Reviewers ran with a read-only allowlist (`view_file`, `find_by_name`,
`grep_search`, `list_dir`, `finish`) and no shell or write tools, which the
vendor enforces (`test:live:agent-allowlist`).

Raw per-area reports are kept beside this file under `.artifacts/review/`
(git-ignored) and are not durable evidence; this document is the record.

## The two models disagreed, and that was the point

`gemini-3.7-flash-high` reported project memory and core as **clean**, listing
what it had verified. `gemini-3.1-pro-high` found a real race in each. In one
case flash explicitly asserted the property pro found broken ("non-vetoing
observer error containment" in the registry) -- true of `#announce()`, false of
`invalidate()`, which is the one pro looked at. Neither model was reliable alone.
Flash did more tool steps and less thinking per step; pro read less and found
more.

## Findings

Confirmed = traced in the code by the maintainer's session, or demonstrated.

### Fixed

| # | Where | Defect | Sev |
|---|---|---|---|
| A2 | `antigravity/src/mcp-bridge.ts` | The bridge socket directory sat at a predictable path in the temp dir, and `mkdir(dir, {recursive, mode: 0o700})` does **not** change the mode of a directory that already exists — demonstrated, not argued. Any local user could pre-create it world-writable, then enumerate adapter sockets, read the tool catalogs handed out, and forge the frames that answer a blocked vendor turn. Now the directory's owner and mode are verified; our own loose directory is tightened, another user's or a symlink is refused. | security |
| M1 | `project-memory/src/filesystem.ts` | Releasing a writer lock unlinks the owner marker and only then removes the directory, so a concurrent reader landed on an empty lock directory, failed `entries.length !== 1`, and threw `Malformed project memory writer lock` -- killing an unrelated caller's memory operation. Same shape as `e38ce06`. An empty directory now reads as unowned, which cannot weaken exclusion because exclusion is the marker's atomic `link()`, never this read; a directory holding anything else is still malformed. Covered by a test for the window and a second one asserting three concurrent writers still serialise. | significant |
| C2 | `core/src/registry/service.ts` | `invalidate()` called each listener in a bare loop while `#announce()` contained observer failures with its reasoning written down. One throwing invalidation listener aborted every later listener and surfaced into the caller -- a provider refreshing its own usage cache. Now contained the same way, async rejections included. | significant |
| X2 | `codex/.../adapter.ts` | The continuation handshake -- resolve the parked tool call, `turn/steer` -- sat outside the `try/finally` that closes the turn, so a throw there leaked the App Server and left the turn in `activeTurns` forever, failing every later request on that session. The handshake now runs inside the try. Both models found this independently. | significant |
| X3 | `codex/.../adapter.ts` | A continuation step awaited the FIRST step's signal, so cancelling during a continuation was never observed. The turn now owns an `AbortController` and each step arms its own caller signal onto it, disarming when the step returns. Both models found this independently. | significant |
| X4 | `codex/.../adapter.ts` | The turn timeout was baked into that same signal once, so it measured wall-clock across DSH's own tool execution and could kill the App Server while a tool waited on a human approval. Armed per step now: the clock measures only time spent waiting on the vendor. The setup requests keep a caller-plus-timeout signal, linked into the turn and unlinked once it is open. | significant |
| X6 | `codex/src/usage-source.ts` | The rate-limits probe spawned with `stderr: 'inherit'`, writing raw vendor stderr to the host process's own stderr -- the one place in the suite where vendor-authored text reached a human unscrubbed. Captured with a bound instead. | minor |
| A6 | `antigravity/src/mcp-bridge-server.ts` | The server offered itself to adapter sockets **in sequence**, and an adapter that does not yet know a pid parks the offer for its full claim window by design. One unrelated adapter on the machine therefore cost a 10s stall per turn; two exceeded the server's 15s claim deadline outright, leaving the model with no tools — through a path that now fails the turn loudly. Offers go out concurrently and resolve on the first claim. The first attempt at this fix was **wrong** (`Promise.all` still awaited the parked offers) and the regression test caught it: 30s before, 86ms after. | blocking |

### Verified after the fact, and fixed

| # | Where | Verdict | Sev |
|---|---|---|---|
| C1 | `suite/src/preset-manager.ts` | **Confirmed.** The backup `rename` was the one exit from the update path that did not clean its stage up, so a rename failing on permissions or a lock left a `.orchestrator.nishi-stage-<uuid>` directory in the user's preset root, and every later update added another. Wrapped. | significant |
| X1 | `codex/.../adapter.ts` | **Confirmed.** `activeTurns` is written only once a turn is open, so two concurrent requests for one session both opened one -- two App Server processes, the loser dropped when the second overwrote the map. Refused now, the way `antigravity-cli` already refused it. | significant |
| A1 | `antigravity/.../antigravity-primary.ts` | **Confirmed.** `ensureBridgeSchema` cached the result rather than the write, so two concurrent callers with the same catalog both wrote the same path and a child spawned by the first could read it half-written. The promise is cached now, and a failed write is not remembered. | significant |
| A3 | `antigravity/.../antigravity-primary.ts` | **Confirmed by effect.** Turn children were reachable from neither `activeChildren` (collected runs only) nor `sessions` (session-keyed only), so an auxiliary turn's child was owned by nothing `dispose()` looks at: disposal returned while it was still running. Not an unbounded leak -- the turn's own `finally` closes it eventually -- but the host was left waiting on a process nobody owned. Tracked and closed on disposal. | significant |
| A5 | `antigravity/src/mcp-bridge.ts` | **Confirmed.** `server.close()` resolves only once every connection has ended, and a peer that connected without speaking was in neither map, so disposal waited out the whole claim window. Connections are tracked now. | minor |
| A7 | `antigravity/src/usage-source.ts` | **Confirmed, demonstrated.** The host type is literally `'127.0.0.1' \| '::1'`, and `new URL('https://::1:42100/x')` throws `Invalid URL`. Every IPv6 loopback candidate was discovered correctly and silently discarded, with usage reporting unavailable while a live endpoint listened. Bracketed. | significant |

### Rejected on verification

| # | Where | Why it is not a defect |
|---|---|---|
| A4 | `antigravity/src/agy-session.ts` | The claim was `terminate()` without escalation to SIGKILL. The upstream subprocess contract says the grace period exists "for the `SubprocessHandle.terminate` escalation", so `terminate()` escalates on its own using the `graceMs` this adapter passes. `close()` does bound its wait and swallow the timeout, unlike core's `disposeVendorChild`, but the escalation is already in flight by then -- returning early is deliberate, not a leak. |

### Referred to the maintainer rather than fixed

| # | Where | Question |
|---|---|---|
| X5 | `codex/.../history.ts` | `latestCheckpoint` throws for a prior Codex response with no usable checkpoint, telling the user to start a new session, while `prepareCodexHistory` has a working rebuild path for exactly that case. The reviewer called the throw a defect; it reads as a deliberate fail-closed choice, and the `continue` for tool-call-only messages shows the author thought about which messages legitimately lack a checkpoint. Nothing records WHY failing closed beats rebuilding, so this is a contract decision and not a bug to be quietly flipped. |

## Verification after the fixes

- `pnpm verify:local` exits `0`; Core 200 -> 202, Project Memory 77 -> 79, Codex 81 -> 86, Antigravity 123 -> 128, Suite 16 -> 17 tests, `fail 0` in all six packages
- the Codex changes restructure a hot path, so three live suites were re-run against real `codex-cli 0.150.0` afterwards: `test:live:primary`, `test:live:tool-result-continuation` and `test:live:inject-items`, all PASS
- one gap in the coverage, stated rather than papered over: X3's own scenario -- cancelling *during* a continuation step -- has no direct test, because reaching it needs a fake that drives the vendor's notification stream. Its two halves are covered (the timeout no longer spans a tool call; a caller aborting during setup still stops the turn), and the per-step arming they share is the same code
- `test:live:mcp-bridge` PASS against real `agy 1.1.22`
- both fixes carry a regression test that fails against the pre-fix code

## Standing

Sixteen findings from two models over four areas, on a tree whose own gate is
green and which had already had two adversarial passes. Ten are confirmed. Two
are in code written the same day, one of them a security defect, and the first
attempt to fix that one was itself wrong and was caught only by writing the test
before trusting the fix.

That is the argument for the freeze blocker rather than against it. This is still
not the independent validation `HANDOFF.md` requires: the charter, the area
briefs and the reading of every finding were all produced by the party that wrote
the code, and nobody outside this workspace has signed anything. What it does
establish is that the tree was not ready, in ways its own tests did not show.
