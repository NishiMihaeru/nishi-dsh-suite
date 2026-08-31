import assert from 'node:assert/strict'
import test from 'node:test'
import { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
import { CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS, CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'
import { codexToolSignature } from '../src/codex-plugin-dsh/tools.ts'

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

function messages() {
  const toolSignature = codexToolSignature(undefined)
  return [
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'first question' }],
    },
    {
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'codex-app-server',
        replayState: {
          response: {
            kind: 'codex-app-server',
            version: 1,
            threadId: 'thread-a',
            turnId: 'turn-a',
            sessionId: 'session-a',
            toolSignature,
          },
        },
      },
      content: [
        { type: 'reasoning', text: 'provider reasoning must not be replayed' },
        { type: 'text', text: 'first answer' },
      ],
    },
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'second question' }],
    },
  ] as any
}

/** No-checkpoint message list: a single current-turn user message. */
function messagesWithoutCheckpoint() {
  return [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first question' }] },
  ] as any
}

/**
 * Same checkpoint as `messages()`, but with one durable tool-result message
 * between the checkpoint and the current turn, so `injectItems` is
 * non-empty: proof that `thread/inject_items` still runs correctly after a
 * `thread/resume` (not only after a `thread/fork`).
 */
function messagesWithHistoricalToolResult() {
  const list = messages()
  list.splice(2, 0, {
    role: 'user',
    source: { kind: 'tool' },
    content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'tool output text' }] }],
  })
  return list
}

function startTurnWith(connection: unknown, messageList: unknown, optionOverrides: Record<string, unknown> = {}) {
  const adapter = new CodexAppServerAdapter({ attachments: {} } as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })
  return { adapter, promise: (adapter as any).startTurn({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    messages: messageList,
    ...optionOverrides,
  }, 'session-a', '/workspace') }
}

test('no checkpoint starts a brand new thread', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/start') return { thread: { id: 'thread-fresh', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-fresh' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messagesWithoutCheckpoint())
  const active = await promise

  assert.equal(active.threadId, 'thread-fresh')
  assert.equal(active.turnId, 'turn-fresh')
  assert.deepEqual(requests, ['thread/start', 'turn/start'])

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('checkpoint at the tip resumes the thread and never forks', async () => {
  const requests: Array<{ method: string; params: any }> = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/resume') return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }] } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-b' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messagesWithHistoricalToolResult())
  const active = await promise

  assert.equal(active.threadId, 'thread-a')
  assert.equal(active.turnId, 'turn-b')
  assert.deepEqual(requests.map(request => request.method), [
    'thread/resume',
    'thread/inject_items',
    'turn/start',
  ])
  assert.equal(requests[0]?.params.threadId, 'thread-a')
  // thread/inject_items still carries the durable history DSH holds since
  // the checkpoint (here, one tool result) into the resumed thread.
  assert.deepEqual(requests[1]?.params, {
    threadId: 'thread-a',
    items: [{ type: 'function_call_output', call_id: 'call-1', output: 'tool output text' }],
  })
  assert.ok(!requests.some(request => request.method === 'thread/fork'), 'the tip case must never fork')
  assert.ok(!requests.some(request => request.method === 'thread/rollback'), 'the tip case must never roll back')

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('checkpoint behind the tip rolls back exactly the trailing turns, then runs the turn', async () => {
  const requests: Array<{ method: string; params: any }> = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }, { id: 'turn-b' }, { id: 'turn-c' }] } }
      }
      if (method === 'thread/rollback') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-d' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-a')
  assert.equal(active.turnId, 'turn-d')
  assert.deepEqual(requests.map(request => request.method), [
    'thread/resume',
    'thread/rollback',
    'turn/start',
  ])
  assert.equal(requests[1]?.params.threadId, 'thread-a')
  // The checkpoint (turn-a) is at index 0 of 3 turns; drop the 2 turns after it.
  assert.equal(requests[1]?.params.numTurns, 2)
  assert.ok(!requests.some(request => request.method === 'thread/fork'), 'a trim-reachable checkpoint must never fork')

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('a throwing thread/rollback rebuilds a new thread from canonical DSH history', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }, { id: 'turn-b' }, { id: 'turn-c' }] } }
      }
      if (method === 'thread/rollback') {
        // thread/rollback has no catalogued vendor error shape; any failure
        // here -- the thread deleted between resume and rollback, a
        // transport drop, any other vendor hiccup -- must still reach the
        // rebuild path, not propagate as a hard turn failure.
        throw new Error('ECONNRESET: transport dropped mid-request')
      }
      if (method === 'thread/start') return { thread: { id: 'thread-rebuilt' } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-rebuilt' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-rebuilt')
  assert.equal(active.turnId, 'turn-rebuilt')
  assert.deepEqual(requests, [
    'thread/resume',
    'thread/rollback',
    'thread/start',
    'thread/inject_items',
    'turn/start',
  ])

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('a duplicated turn id resolves toward in-sync rather than triggering a destructive rollback', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      // The checkpoint's turn id ('turn-a') appears twice; the LAST
      // occurrence is the tip. If tip detection matched the first
      // occurrence instead, it would misclassify this in-sync checkpoint as
      // "ahead" and issue a destructive thread/rollback against turns that
      // are still current.
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }, { id: 'turn-b' }, { id: 'turn-a' }] } }
      }
      if (method === 'turn/start') return { turn: { id: 'turn-d' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-a')
  assert.equal(active.turnId, 'turn-d')
  assert.deepEqual(requests, ['thread/resume', 'turn/start'])
  assert.ok(!requests.includes('thread/rollback'), 'a duplicate resolving to in-sync must never roll back')
  assert.ok(!requests.includes('thread/fork'), 'a duplicate resolving to in-sync must never fork')

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('a malformed thread.turns in the resume response rebuilds a new thread from canonical DSH history', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/resume') {
        // thread.turns missing/not-an-array is not a vendor error shape, so
        // it can never match a JsonRpcResponseError -- it must still reach
        // the same rebuild path every named resume/fork error already does.
        return { thread: { id: 'thread-a', turns: 'not-an-array' } }
      }
      if (method === 'thread/start') return { thread: { id: 'thread-rebuilt' } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-rebuilt' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-rebuilt')
  assert.equal(active.turnId, 'turn-rebuilt')
  assert.deepEqual(requests, [
    'thread/resume',
    'thread/start',
    'thread/inject_items',
    'turn/start',
  ])

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('checkpoint turn absent from the resumed thread falls back to thread/fork', async () => {
  const requests: Array<{ method: string; params: any }> = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-unrelated-1' }, { id: 'turn-unrelated-2' }] } }
      }
      if (method === 'thread/fork') return { thread: { id: 'thread-forked' } }
      if (method === 'turn/start') return { turn: { id: 'turn-forked' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-forked')
  assert.equal(active.turnId, 'turn-forked')
  assert.deepEqual(requests.map(request => request.method), [
    'thread/resume',
    'thread/fork',
    'turn/start',
  ])
  assert.equal(requests[1]?.params.threadId, 'thread-a')
  assert.equal(requests[1]?.params.lastTurnId, 'turn-a')
  assert.ok(!requests.some(request => request.method === 'thread/rollback'), 'an unreachable checkpoint must never roll back')

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('a resume-time thread-not-found error rebuilds a new thread from canonical DSH history', async () => {
  const requests: Array<{ method: string; params: any }> = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/resume') {
        throw new JsonRpcResponseError(-32600, 'thread not found: thread-a')
      }
      if (method === 'thread/start') return { thread: { id: 'thread-rebuilt' } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-rebuilt' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-rebuilt')
  assert.equal(active.turnId, 'turn-rebuilt')
  assert.deepEqual(requests.map(request => request.method), [
    'thread/resume',
    'thread/start',
    'thread/inject_items',
    'turn/start',
  ])
  assert.equal(requests[0]?.params.threadId, 'thread-a')
  assert.deepEqual(requests[1]?.params.dynamicTools, [])
  assert.deepEqual(requests[2]?.params, {
    threadId: 'thread-rebuilt',
    items: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'first question' }],
      },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'first answer', annotations: [] }],
      },
    ],
  })
  assert.deepEqual(requests[3]?.params, {
    threadId: 'thread-rebuilt',
    input: [{ type: 'text', text: 'second question', text_elements: [] }],
    model: 'gpt-5.6-sol',
  })

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('a fork-time turn-not-found error also rebuilds a new thread from canonical DSH history', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-unrelated' }] } }
      }
      if (method === 'thread/fork') {
        throw new JsonRpcResponseError(-32600, "lastTurnId 'turn-a' was not found in the source thread")
      }
      if (method === 'thread/start') return { thread: { id: 'thread-rebuilt' } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-rebuilt' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())
  const active = await promise

  assert.equal(active.threadId, 'thread-rebuilt')
  assert.equal(active.turnId, 'turn-rebuilt')
  assert.deepEqual(requests, ['thread/resume', 'thread/fork', 'thread/start', 'thread/inject_items', 'turn/start'])

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('unrelated thread/resume errors remain fail-closed and are not rebuilt', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/resume') {
        throw new JsonRpcResponseError(-32600, 'sandbox override is invalid')
      }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())

  await assert.rejects(promise, /sandbox override is invalid/)
  assert.deepEqual(requests, ['thread/resume'])
  assert.equal(closeCalls, 1)
})

test('unrelated thread/fork errors remain fail-closed and are not rebuilt', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-unrelated' }] } }
      }
      if (method === 'thread/fork') {
        throw new JsonRpcResponseError(-32600, 'sandbox override is invalid')
      }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const { adapter, promise } = startTurnWith(connection, messages())

  await assert.rejects(promise, /sandbox override is invalid/)
  assert.deepEqual(requests, ['thread/resume', 'thread/fork'])
  assert.equal(closeCalls, 1)
})

test('thread/resume carries the same configuration overrides as thread/start and thread/fork', async () => {
  const requests: Array<{ method: string; params: any }> = []
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/resume') return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }] } }
      if (method === 'turn/start') return { turn: { id: 'turn-b' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }

  const { adapter, promise } = startTurnWith(connection, messages(), { system: 'the current runtime-context snapshot' })
  await promise

  const resume = requests.find(request => request.method === 'thread/resume')
  assert.deepEqual(resume?.params, {
    threadId: 'thread-a',
    cwd: '/workspace',
    model: 'gpt-5.6-sol',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config: { isolated: true },
    baseInstructions: 'the current runtime-context snapshot',
    developerInstructions: CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS,
  })

  await adapter.dispose()
})

test('a changed system prompt on a later turn reaches the thread/resume call, not a stale one', async () => {
  async function resumeBaseInstructions(system: string): Promise<string> {
    const requests: Array<{ method: string; params: any }> = []
    const connection = {
      async initialize() {},
      async request(method: string, params: any) {
        requests.push({ method, params })
        if (method === 'thread/resume') return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }] } }
        if (method === 'turn/start') return { turn: { id: 'turn-b' } }
        throw new Error(`unexpected request ${method}`)
      },
      interrupt() {},
      async close() {},
    }
    const { adapter, promise } = startTurnWith(connection, messages(), { system })
    await promise
    await adapter.dispose()
    const resume = requests.find(request => request.method === 'thread/resume')
    return resume?.params.baseInstructions
  }

  // Two independent turns resuming the same checkpoint with two different
  // DSH runtime-context snapshots must each carry their own current
  // baseInstructions to thread/resume -- proof the override is read fresh
  // per turn and not pinned to whatever the thread was created with.
  assert.equal(await resumeBaseInstructions('snapshot one'), 'snapshot one')
  assert.equal(await resumeBaseInstructions('snapshot two, which supersedes snapshot one'), 'snapshot two, which supersedes snapshot one')
})

test('the turn timeout does not run while DSH is executing a tool', async () => {
  // The turn timeout used to be baked into the turn's signal once, in startTurn,
  // so it measured wall-clock across every DSH step the turn spanned. A tool
  // waiting on a human approval therefore spent the vendor's budget and killed
  // the App Server mid-turn. It is now armed per step and disarmed when the step
  // returns, so the clock measures only time spent waiting on the vendor.
  const connection = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-t', turns: [] } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-t' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const adapter = new CodexAppServerAdapter({ attachments: {} } as any, { ...config, turnTimeoutMs: 120 })
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })
  const active = await (adapter as any).startTurn({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    messages: messages(),
  }, 'session-timeout', '/workspace')

  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(
    active.signal.aborted, false,
    'the open turn was aborted by its own timeout while no step was waiting on the vendor',
  )
  await adapter.dispose()
})

test('a caller that aborts while the turn is being opened still stops it', async () => {
  // The other half of the same change: the setup requests must remain
  // cancellable, so the caller's signal is linked into the turn for the duration
  // of the opening and unlinked once it is open.
  const controller = new AbortController()
  const connection = {
    async initialize() {},
    async request(method: string, _params: unknown, signal: AbortSignal) {
      if (method === 'thread/start') {
        controller.abort(new Error('caller went away'))
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          setTimeout(resolve, 2_000)
        })
        return { thread: { id: 'thread-x', turns: [] } }
      }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const adapter = new CodexAppServerAdapter({ attachments: {} } as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })
  await assert.rejects(() => (adapter as any).startTurn({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    messages: messages(),
    signal: controller.signal,
  }, 'session-abort', '/workspace'))
  await adapter.dispose()
})

test('a throw in the continuation handshake closes the turn instead of wedging the session', async () => {
  // The continuation handshake -- resolve the parked tool call, steer -- used to
  // sit OUTSIDE the try/finally that closes the turn. A throw there leaked the
  // App Server process and left the turn in `activeTurns` forever, so every
  // later request on that session failed instantly on a turn nobody could clear.
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-w', turns: [] } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-w' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }
  const sessionId = 'session-wedge'
  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: sessionId, cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const active = await (adapter as any).startTurn({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    messages: messages(),
  }, sessionId, '/workspace')
  ;(adapter as any).activeTurns.set(sessionId, active)
  // Park a tool call the way the event loop would, then ask for the next step
  // with a history that carries no result for it.
  active.awaiting = {
    call: { threadId: 'thread-w', turnId: 'turn-w', callId: 'call-missing', namespace: 'dsh', tool: 'x', arguments: {} },
    response: { resolve() {}, reject() {} },
  }

  await assert.rejects(async () => {
    for await (const _chunk of adapter.stream({
      provider: 'codex-app-server',
      model: 'gpt-5.6-sol',
      sessionId,
      messages: messages(),
      signal: AbortSignal.timeout(5_000),
    } as any)) { /* the handshake throws before any chunk */ }
  })

  assert.equal(
    (adapter as any).activeTurns.get(sessionId), undefined,
    'the failed turn is still registered, so the session is wedged',
  )
  assert.equal(closeCalls, 1, 'the App Server connection was leaked')
  await adapter.dispose()
})
