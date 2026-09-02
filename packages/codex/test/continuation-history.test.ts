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

/**
 * An adapter holding one turn parked on a dynamic tool call.
 *
 * `sealEvents` closes the event queue so a continuation that gets PAST the
 * guards fails by name instead of blocking on a vendor that will never speak.
 * The vendor-abandonment test needs the queue OPEN, because what it is about
 * is exactly what the vendor left buffered there.
 */
async function parkedOnToolCall({ sealEvents = true }: { sealEvents?: boolean } = {}) {
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
  if (sealEvents) turn.events.fail(new Error('reached the event loop'))
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

/**
 * The vendor's own state moving under a parked call, which is the other half
 * of the same window and was found by carrying the Antigravity fix across.
 *
 * DSH stops consuming the App Server's notifications while its own loop runs
 * the tool, so a turn the vendor finished around its outstanding call waits in
 * the queue. Answering into that used to succeed: the buffered agent message
 * replayed on the continuing step, set `finalOutput`, and the turn yielded an
 * ordinary `stop`. Probed against this adapter before the guard existed --
 * `finish { kind: "stop" }`, no error, no diagnostic -- so a whole turn of
 * reasoning built on a result the model never received was recorded as a
 * normal answer.
 *
 * Whether a conforming Codex App Server can abandon an outstanding JSON-RPC
 * request this way is a separate question and still unestablished. The guard
 * does not depend on the answer: it costs one array scan and turns a silent
 * wrong answer into a discarded turn that realigns through `startTurn`.
 */
test('a vendor turn that ended around its parked tool call is refused, not answered into', async () => {
  const { adapter, turn } = await parkedOnToolCall({ sealEvents: false })

  // Everything the vendor emits after abandoning the call, buffered while DSH
  // is away executing the tool and replayed on the continuing step.
  turn.events.push({
    kind: 'notification',
    notification: {
      method: 'item/completed',
      params: {
        threadId: 'thread-a',
        turnId: 'turn-a',
        item: { type: 'agentMessage', id: 'msg-1', text: 'I never got the lookup result, so here is my guess.' },
      },
    },
  })
  turn.events.push({
    kind: 'notification',
    notification: {
      method: 'turn/completed',
      params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } },
    },
  })

  await assert.rejects(
    drain(adapter, [OPENED_WITH[0], ASSISTANT_CALL, TOOL_RESULT]),
    /the vendor turn ended while a dynamic tool call was still parked/,
  )
})

/** A retrying error is not a turn end, and must not refuse a good continuation. */
test('a retrying error buffered under a parked call does not refuse the continuation', async () => {
  const { adapter, turn } = await parkedOnToolCall({ sealEvents: false })
  turn.events.push({
    kind: 'notification',
    notification: { method: 'error', params: { willRetry: true, error: { message: 'transient' } } },
  })
  turn.events.fail(new Error('reached the event loop'))

  // Reaching the event loop is the pass condition: the guard let it through.
  await assert.rejects(
    drain(adapter, [OPENED_WITH[0], ASSISTANT_CALL, TOOL_RESULT]),
    /reached the event loop/,
  )
})

/**
 * The earlier and more precise trigger, taken from the vendor's own vocabulary.
 *
 * A `dynamicToolCall` thread item carries `status: "inProgress" | "completed" |
 * "failed"` in the App Server's generated protocol bindings, and the vendor
 * completes that item when it is done with the call. Three live probes put the
 * healthy ordering beyond doubt: the completion arrived within 1 ms AFTER DSH
 * answered, never before it. Buffered ahead of the answer it therefore means
 * the vendor stopped waiting -- and unlike a buffered `turn/completed`, it says
 * so even when the turn is still running and about to issue more calls, which
 * is the half the turn-end scan alone cannot see.
 */
test('a tool call the vendor completed by itself is refused, even with the turn still running', async () => {
  const { adapter, turn } = await parkedOnToolCall({ sealEvents: false })
  turn.events.push({
    kind: 'notification',
    notification: {
      method: 'item/completed',
      params: {
        threadId: 'thread-a',
        turnId: 'turn-a',
        item: { type: 'dynamicToolCall', id: 'item-1', tool: 'lookup', status: 'failed', success: false },
      },
    },
  })

  await assert.rejects(
    drain(adapter, [OPENED_WITH[0], ASSISTANT_CALL, TOOL_RESULT]),
    /the vendor completed the tool call itself \(status "failed"\) while a dynamic tool call was still parked/,
  )
})

/** An unrelated item completing under a parked call is not the vendor giving up. */
test('an unrelated buffered item does not refuse the continuation', async () => {
  const { adapter, turn } = await parkedOnToolCall({ sealEvents: false })
  turn.events.push({
    kind: 'notification',
    notification: {
      method: 'item/completed',
      params: { threadId: 'thread-a', turnId: 'turn-a', item: { type: 'reasoning', id: 'r-1' } },
    },
  })
  turn.events.fail(new Error('reached the event loop'))

  await assert.rejects(
    drain(adapter, [OPENED_WITH[0], ASSISTANT_CALL, TOOL_RESULT]),
    /reached the event loop/,
  )
})
