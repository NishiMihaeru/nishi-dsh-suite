import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'

/**
 * The history a parked dynamic tool call is resumed against.
 *
 * An App Server turn does not end when the model wants a DSH tool: it parks
 * inside `item/tool/call` while DSH's own loop executes, so one vendor turn
 * spans several DSH steps. Everything that rewrites DSH history lands in
 * exactly that gap -- compaction, the tool-result pruner, repair, a user
 * rewind -- and the continuation used to check only the model and the tool
 * catalog. A rewrite of the history BEFORE the parked call failed nowhere: the
 * vendor thread still holds the original prefix server-side, so the model
 * resumes reasoning from a history DSH no longer has, and its answer is
 * recorded against the new one.
 *
 * Ending the turn is the fix rather than realigning here: the next request goes
 * through `startTurn`, where the checkpoint tip comparison already realigns by
 * resume, rollback, fork or rebuild.
 */

const config = {
  executable: 'codex',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 600_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
  modelPageSize: 100,
}

const OPENED_WITH = [
  { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first question' }] },
] as any

/** The turn's own tool call, as DSH records it once the adapter yields it. */
const ASSISTANT_CALL = {
  role: 'assistant',
  source: { kind: 'model', provider: 'codex-app-server' },
  content: [{ type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{}' }],
} as any

const TOOL_RESULT = {
  role: 'user',
  source: { kind: 'tool', callId: 'call-1' },
  content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] }],
} as any

/** An adapter holding one turn parked on a dynamic tool call. */
async function parkedOnToolCall() {
  const connection = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-a', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-a' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const adapter = new CodexAppServerAdapter({
    attachments: {},
    sessions: { get: () => ({ header: { cwd: '/workspace' } }) },
  } as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const turn = await (adapter as any).startTurn({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    messages: OPENED_WITH,
  }, 'session-a', '/workspace')

  const response = Promise.withResolvers<unknown>()
  // Disposing the adapter rejects the parked call by design; nothing in a test
  // awaits it, and an unobserved rejection would fail the file rather than the
  // assertion.
  response.promise.catch(() => {})
  turn.awaiting = {
    kind: 'dynamic-tool',
    call: { callId: 'call-1', tool: 'lookup', arguments: {}, threadId: 'thread-a', turnId: 'turn-a' },
    response,
  }
  // So a continuation that gets PAST the guards fails by name instead of
  // blocking on a vendor that will never speak: without the history check the
  // divergent case below resolves the parked call and then waits here forever.
  turn.events.fail(new Error('reached the event loop'))
  return { adapter, turn }
}

async function drain(adapter: unknown, messages: unknown): Promise<void> {
  for await (const _ of (adapter as any).stream({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-a',
    messages,
  })) { /* the rejection is the subject */ }
}

test('a history rewritten while a dynamic tool call is parked ends the turn instead of resuming', async () => {
  const { adapter } = await parkedOnToolCall()
  try {
    await assert.rejects(
      async () => {
        // Everything the continuation needs is present and valid -- the tool
        // result included. Only the message the turn was opened against has
        // been rewritten, which is what a compaction or a repair looks like
        // from here.
        await drain(adapter, [
          { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'a different first question' }] },
          ASSISTANT_CALL,
          TOOL_RESULT,
        ])
      },
      /the DSH history changed while an App Server dynamic tool call was pending/,
    )
  } finally {
    await adapter.dispose()
  }
})

test('an unchanged prefix passes the history check and continues to the tool result', async () => {
  const { adapter } = await parkedOnToolCall()
  try {
    await assert.rejects(
      async () => {
        // The prefix agrees and the history has only grown, so the guard must
        // let this through. It then fails on the missing tool result, which is
        // exactly how we know the guard did not fire.
        await drain(adapter, [...OPENED_WITH, ASSISTANT_CALL])
      },
      /DSH did not return tool result/,
    )
  } finally {
    await adapter.dispose()
  }
})
