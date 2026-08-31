# Whole-tree adversarial review: two models, four areas

- **Result**: `DEFECTS FOUND` — 16 distinct findings reported, 10 confirmed so far, 2 fixed, 6 confirmed and open, 6 not yet verified
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
| A6 | `antigravity/src/mcp-bridge-server.ts` | The server offered itself to adapter sockets **in sequence**, and an adapter that does not yet know a pid parks the offer for its full claim window by design. One unrelated adapter on the machine therefore cost a 10s stall per turn; two exceeded the server's 15s claim deadline outright, leaving the model with no tools — through a path that now fails the turn loudly. Offers go out concurrently and resolve on the first claim. The first attempt at this fix was **wrong** (`Promise.all` still awaited the parked offers) and the regression test caught it: 30s before, 86ms after. | blocking |

### Confirmed and open

| # | Where | Defect | Sev |
|---|---|---|---|
| M1 | `project-memory/src/filesystem.ts:481` | Releasing a writer lock unlinks the owner marker and only then removes the directory. In that window the lock directory exists with zero entries, and a concurrent reader fails `entries.length !== 1` and throws `Malformed project memory writer lock` — an unrelated caller's memory operation dies. Same shape as the race fixed in `e38ce06`. Exclusion comes from the marker's atomic `link()`, not from this read, so an empty directory honestly means "no owner": returning `null` is both correct and safe. | significant |
| C2 | `core/src/registry/service.ts:127` | `invalidate()` calls each listener in a bare loop while `#announce()` contains observer failures with a documented "non-vetoing" rationale. One throwing invalidation listener aborts the rest and surfaces into the provider's usage-invalidation path. | significant |
| X2 | `codex/.../adapter.ts:589-621` | The continuation branch — resolve the parked tool call, `turn/steer` — sits **outside** the `try/finally` that calls `closeTurn`. A throw there (missing tool result, already-aborted signal, a rejected steer) leaks the App Server process and leaves the turn in `activeTurns` forever, so every later request on that session fails instantly. Both models found this independently. | significant |
| X3 | `codex/.../adapter.ts:625` | A continuation step awaits `active.signal`, bound to the **first** step's signal. Cancelling during a continuation is never observed, `interrupt` is never sent, and the step hangs until the turn timeout. Both models found this independently. | significant |
| X4 | `codex/.../adapter.ts` | `turnTimeoutMs` is bound once into `active.signal`, so it spans DSH's own tool execution. A tool that waits on a human approval can silently kill the App Server mid-turn. Note the tension with Antigravity's bridge, which scopes its timeout the same way for the opposite reason: neither suspends the clock while DSH executes, which is what both actually want. | significant |
| X6 | `codex/src/usage-source.ts:148` | The rate-limits probe spawns with `stderr: 'inherit'`, so raw vendor stderr reaches the host process's stderr unscrubbed. Against a suite whose stated posture is that vendor-authored text never reaches the user verbatim, this is a posture violation, not a cosmetic one. | minor |

### Reported, not yet verified

| # | Where | Claim |
|---|---|---|
| C1 | `suite/src/preset-manager.ts:255` | A failed backup `rename` leaves the staged preset directory orphaned on disk. |
| X1 | `codex/.../adapter.ts:589` | Two concurrent `stream()` calls for one session both miss `activeTurns` and spawn two App Servers, one of which leaks. |
| X5 | `codex/.../history.ts:71` | `latestCheckpoint` throws for a prior assistant message with no usable checkpoint, instead of returning `undefined` and letting the documented rebuild path run. |
| A1 | `antigravity/.../antigravity-primary.ts` | `ensureBridgeSchema` memoizes after the write, so two concurrent callers write the same schema file and a vendor child can read it half-written. |
| A3 | `antigravity/.../antigravity-primary.ts` | `dispose()` may miss auxiliary-turn children and children still mid-startup. |
| A4 | `antigravity/src/agy-session.ts:198` | `terminate()` without escalation to SIGKILL, with the wait's rejection swallowed. |
| A5 | `antigravity/src/mcp-bridge.ts` | `close()` waits out the claim window for a connection that never sent `hello`. |
| A7 | `antigravity/src/usage-source.ts:516` | An IPv6 loopback endpoint is interpolated without brackets, so `new URL()` rejects every `::1` candidate. |

## Verification after the two fixes

- `pnpm verify:local` exits `0`; Antigravity 123 -> 125 tests, `fail 0` in all six packages
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
