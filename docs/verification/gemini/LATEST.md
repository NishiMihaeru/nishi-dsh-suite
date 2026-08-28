# Latest Gemini validation

- Result: PASS
- Branch: feat/core-provider-plugins-rc3
- Tested HEAD: b3948f3443fc7d0418b64c688865fb7c0ec9eebf
- Tested commits:
  - `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1` — fix(memory): select maintenance route before prompt assembly
  - `b3948f3443fc7d0418b64c688865fb7c0ec9eebf` — test(memory): cover maintenance route timing
- Environment:
  - Node: v24.19.0 (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: 11.21.0
  - Current installed DSH baseline: `0.1.1-rc.2` (package family `0.1.0-rc.3`)
  - Upstream DSH reference: `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

## Scope

Strictly:
- `packages/project-memory/src/commands.ts`
- `packages/project-memory/test/memory-directives.test.ts`

No implementation changes, no changes to root dependencies, lockfile, or workflow files.

## Upstream Lifecycle Findings (`dsh-v0.1.2-alpha.1`)

1. **Agent Loop Step Lifecycle Order (`packages/core/agent-loop/src/agent.ts:232-250`)**:
   - In `ReactLoopAgent.prototype.preStep()`:
     1. `const claimed = this.inbox.claim(target, position.turn)` executes first.
     2. `Inbox.prototype.claim()` in `packages/core/agent/src/inbox.ts` mutates inbox queues and synchronously fires `notifications.claimed(message, turn)`, which dispatches the event `'agent/inbox/claimed'` with payload `{ agent, message, turn }`.
     3. `const assembly = await this.loopCtx.systemPrompt.assemble(...)` executes second.
     4. `agent/pre-step` waterfall executes third.
     5. `step()` -> `buildRequest()` runs `agent/request` waterfall fourth.

2. **Model Selection Snapshot Semantics (`packages/core/agent/src/model-selection.ts`)**:
   - `installModelSelection(agentCtx, selection)` listens on `'system-prompt/assemble'` (line 40) and snapshots `selection.assembled = selection.current`.
   - When `'agent/request'` is dispatched (line 54), it applies `selection.assembled` to resolve `provider`, `model`, and reasoning effort.
   - **Root Cause of Prior Bug**: When route activation waited for `'agent/pre-step'`, `selection.current` was still `undefined` during `'system-prompt/assemble'`, snapshotting `selection.assembled = undefined`. Thus, the first step of a maintenance turn was dispatched using the default route instead of the requested route.
   - **Fix Verification**: Activating `selectionRef.current` inside the `'agent/inbox/claimed'` handler ensures `selectionRef.current` is populated *before* `'system-prompt/assemble'` executes, ensuring the first maintenance step correctly snapshots and applies the targeted route.

3. **Baseline Compatibility (`dsh-v0.1.1-rc.2`)**:
   - Verified that `'agent/inbox/claimed'` with signature `{ agent: Agent, message: UserMessage, turn: number }` was already part of `dsh-v0.1.1-rc.2` (`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:194`).
   - The fix is fully backward-compatible with both `0.1.1-rc.2` and `0.1.2-alpha.1`.

## Property & Contract Verification

| # | Property / Invariant | Status | Evidence / Implementation Detail |
|---|---|---|---|
| 1 | `scheduleMaintenanceTurn()` no longer waits for `agent/pre-step` | PASS | `agent.ctx.on('agent/pre-step')` replaced by `agent.ctx.on('agent/inbox/claimed')`. |
| 2 | Exact maintenance message determined by ID & object identity | PASS | Checked via `message?.id !== targetMessageId && message !== maintenanceMessage`. |
| 3 | On `agent/inbox/claimed` for maintenance message, route & turn are set | PASS | Sets `selectionRef.current = { provider: route.provider, model: route.model }`, `activated = true`, and captures `turn`. |
| 4 | Route selection occurs before `system-prompt/assemble` | PASS | Verified against upstream `agent.ts:236-237` sequence; `installModelSelection` sees `selection.current` immediately. |
| 5 | First `agent/request` receives selected provider/model | PASS | `selection.assembled` has selected route, overriding default provider/model. |
| 6 | Selection is scoped to the maintenance turn | PASS | `disposeTurnStopping` and `disposeError` check matching `payload.turn === maintenanceTurn`. |
| 7 | Cleanup runs on turn-stopping, error, whenIdle(), and steer() error | PASS | Handled in `disposeTurnStopping`, `disposeError`, `agent.whenIdle().then(cleanup, cleanup)`, and `try { agent.steer() } catch { cleanup(); throw err }`. |
| 8 | Cleanup clears state and disposes all listeners | PASS | Sets `selectionRef.current = undefined`, `selectionRef.assembled = undefined`, removes agent from `activeMaintenanceAgents`, and calls all disposer functions. |
| 9 | Duplicate concurrent maintenance rejected on same agent | PASS | Guarded by `activeMaintenanceAgents.has(agent)` WeakSet check in `/memory` and `/consolidate` command handlers. |
| 10 | No listener, promise, or handle leaks | PASS | Idempotent cleanup (`cleanedUp` guard) safely disposes all 4 event subscriptions and model selection hook. |

## Regression Test Assessment

- Test: `maintenance route is selected when its inbox message is claimed, before prompt assembly` in `packages/project-memory/test/memory-directives.test.ts`.
- Verified behaviors:
  1. Steers directive message into the agent.
  2. Emits `agent/inbox/claimed` with the steered message ID and turn index.
  3. Validates that `system-prompt/assemble` yields variables `{ provider: 'codex-app-server', model: 'gpt-5.6-sol' }`.
  4. Validates that `agent/request` receives `{ provider: 'codex-app-server', model: 'gpt-5.6-sol' }` and that unselected inherited reasoning effort (`reasoningEffort: 'high'`) is stripped cleanly.
  5. Validates that on `agent.whenIdle()` resolution, all registered listeners (`agent/inbox/claimed`, `system-prompt/assemble`, `agent/request`, `agent/error`, `agent/turn-stopping`) are disposed.

## Executed Commands and Results

| Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `0` | PASS | 25/25 unit tests passed (duration: ~223ms) |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | PASS | Typecheck clean (`tsc -p tsconfig.json --noEmit`) |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | PASS | Build clean (`tsc -p tsconfig.json`) |

## Disposable Upstream Alpha.1 Probe

A disposable runtime probe was executed directly importing `installModelSelection` from `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) against `scheduleMaintenanceTurn`:
- Exact upstream `installModelSelection` + simulated `ReactLoopAgent` pre-step sequence: **PASS**
- Turn error teardown against upstream alpha.1: **PASS**
- Turn-stopping teardown against upstream alpha.1: **PASS**
- Steer exception teardown: **PASS**
- Zero lingering listeners: **PASS**

## Verdict

**PASS**

The fix in `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1` and regression test in `b3948f3443fc7d0418b64c688865fb7c0ec9eebf` correctly resolve the maintenance route selection timing issue before prompt assembly in accordance with DSH upstream lifecycle contracts (`dsh-v0.1.2-alpha.1` and `dsh-v0.1.1-rc.2`). All validation gates and regression tests pass with exit code 0.
