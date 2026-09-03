import assert from 'node:assert/strict'
import test from 'node:test'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'
import { codexHistoryDigest } from '../src/codex-plugin-dsh/history.ts'

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

function messagesWithCheckpoint() {
  const user1 = {
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'first question' }],
  }
  return [
    user1,
    {
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'codex-app-server',
        replayState: {
          response: {
            kind: 'codex-app-server',
            version: 2,
            threadId: 'thread-a',
            turnId: 'turn-a',
            sessionId: 'session-a',
            prefixLength: 1,
            prefixDigest: codexHistoryDigest([user1 as any]),
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

test('1. a compaction-shaped request issues no thread/resume, thread/fork or thread/rollback, and thread/start carries ephemeral: true', async () => {
  const requests: Array<{ method: string; params: any }> = []
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'thread-compaction', turns: [] } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-compaction' } }
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-a', turns: [{ id: 'turn-a' }, { id: 'turn-b' }, { id: 'turn-c' }] } }
      }
      if (method === 'thread/rollback') return {}
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }

  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-a', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const options = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-a',
    purpose: 'compaction',
    maxTokens: 512,
    messages: messagesWithCheckpoint(),
  }

  const iterator = adapter.stream(options as any)[Symbol.asyncIterator]()
  const pending = iterator.next()

  let active: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    for (const t of (adapter as any).activeTurns.values()) {
      if (t.sessionId === 'session-a') {
        active = t
        break
      }
    }
    if (active !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(active, 'auxiliary turn must be registered')

  active.events.push({
    method: 'item/completed',
    params: {
      threadId: active.threadId,
      turnId: active.turnId,
      item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer', text: 'Compaction summary text' },
    },
  })
  active.events.push({
    method: 'turn/completed',
    params: {
      threadId: active.threadId,
      turn: { id: active.turnId, status: 'completed' },
    },
  })

  let result = await pending
  while (!result.done) {
    result = await iterator.next()
  }

  assert.ok(!requests.some(r => r.method === 'thread/resume'), 'must issue no thread/resume')
  assert.ok(!requests.some(r => r.method === 'thread/fork'), 'must issue no thread/fork')
  assert.ok(!requests.some(r => r.method === 'thread/rollback'), 'must issue no thread/rollback')

  const threadStart = requests.find(r => r.method === 'thread/start')
  assert.ok(threadStart, 'must issue thread/start')
  assert.equal(threadStart.params.ephemeral, true, 'thread/start must carry ephemeral: true')
})

test('2. the same request sends no outputSchema key, no developerInstructions key, and its finish chunk carries no replay state', async () => {
  const requests: Array<{ method: string; params: any }> = []
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'thread-compaction-2', turns: [] } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-compaction-2' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }

  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-a', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const options = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-a',
    purpose: 'compaction',
    maxTokens: 512,
    messages: messagesWithCheckpoint(),
  }

  const iterator = adapter.stream(options as any)[Symbol.asyncIterator]()
  const pending = iterator.next()

  let active: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    for (const t of (adapter as any).activeTurns.values()) {
      if (t.sessionId === 'session-a') {
        active = t
        break
      }
    }
    if (active !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(active, 'turn must be registered')

  active.events.push({
    method: 'item/completed',
    params: {
      threadId: active.threadId,
      turnId: active.turnId,
      item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer', text: 'Summary result' },
    },
  })
  active.events.push({
    method: 'turn/completed',
    params: {
      threadId: active.threadId,
      turn: { id: active.turnId, status: 'completed' },
    },
  })

  const chunks: StreamChunk[] = []
  let result = await pending
  while (!result.done) {
    chunks.push(result.value)
    result = await iterator.next()
  }

  const threadStart = requests.find(r => r.method === 'thread/start')
  assert.ok(threadStart, 'must issue thread/start')
  assert.equal('developerInstructions' in threadStart.params, false, 'thread/start must not carry developerInstructions key')

  const turnStart = requests.find(r => r.method === 'turn/start')
  assert.ok(turnStart, 'must issue turn/start')
  assert.equal('outputSchema' in turnStart.params, false, 'turn/start must not carry outputSchema key')

  const finishChunk = chunks.find(c => c.type === 'finish') as any
  assert.ok(finishChunk, 'must yield finish chunk')
  assert.equal('replayState' in finishChunk, false, 'finish chunk must carry no replayState key')
  assert.equal(finishChunk.replayState, undefined)
})

test('3. an auxiliary turn plain agent text is streamed and finishes as stop, with no decision parsing involved', async () => {
  const requests: Array<{ method: string; params: any }> = []
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'thread-aux', turns: [] } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-aux' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-aux', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  // Non-JSON plain text that would fail codexDecision if parsed
  const plainText = 'This is a compaction summary.\nLine 2: not JSON at all! { "invalid": json'
  const options = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-aux',
    purpose: 'compaction',
    messages: [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'summarize' }] },
    ],
  }

  const iterator = adapter.stream(options as any)[Symbol.asyncIterator]()
  const pending = iterator.next()

  let active: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    for (const t of (adapter as any).activeTurns.values()) {
      if (t.sessionId === 'session-aux') {
        active = t
        break
      }
    }
    if (active !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(active, 'active turn registered')

  active.events.push({
    method: 'item/started',
    params: {
      threadId: active.threadId,
      turnId: active.turnId,
      item: { id: 'msg-plain', type: 'agentMessage', phase: 'final_answer' },
    },
  })
  active.events.push({
    method: 'item/agentMessage/delta',
    params: {
      threadId: active.threadId,
      turnId: active.turnId,
      itemId: 'msg-plain',
      delta: plainText,
    },
  })
  active.events.push({
    method: 'item/completed',
    params: {
      threadId: active.threadId,
      turnId: active.turnId,
      item: { id: 'msg-plain', type: 'agentMessage', phase: 'final_answer', text: plainText },
    },
  })
  active.events.push({
    method: 'turn/completed',
    params: {
      threadId: active.threadId,
      turn: { id: active.turnId, status: 'completed' },
    },
  })

  const chunks: StreamChunk[] = []
  let result = await pending
  while (!result.done) {
    chunks.push(result.value)
    result = await iterator.next()
  }

  const chunkTypes = chunks.map(c => c.type)
  assert.deepEqual(chunkTypes, ['block-start', 'text-delta', 'block-end', 'finish'])
  const textDelta = chunks.find(c => c.type === 'text-delta') as any
  assert.equal(textDelta.text, plainText)
  const blockEnd = chunks.find(c => c.type === 'block-end') as any
  assert.deepEqual(blockEnd.block, { type: 'text', text: plainText })
  const finish = chunks.find(c => c.type === 'finish') as any
  assert.equal(finish.reason.kind, 'stop')
})

test('4. maxTokens is accepted with a purpose and still rejected without one; temperature and stop are rejected either way', async () => {
  const connection = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-params', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-params' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-params', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const baseOptions = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-params',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
  }

  // 1. maxTokens without purpose is rejected.
  //
  // `stream()` is an async generator, so obtaining its iterator runs none of the
  // body and `assert.throws` around that call can never see anything. The
  // rejection surfaces on the first `next()`.
  await assert.rejects(
    adapter.stream({ ...baseOptions, maxTokens: 100 } as any)[Symbol.asyncIterator]().next(),
    /App Server does not support DSH request field\(s\): maxTokens/,
  )

  // 2. maxTokens with purpose is accepted (starts stream normally)
  {
    const iter = adapter.stream({ ...baseOptions, purpose: 'compaction', maxTokens: 100 } as any)[Symbol.asyncIterator]()
    const pending = iter.next()
    let active: any
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      for (const t of (adapter as any).activeTurns.values()) {
        if (t.sessionId === 'session-params') {
          active = t
          break
        }
      }
      if (active !== undefined) break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.ok(active, 'active turn opened with maxTokens and purpose')
    active.events.push({
      method: 'item/completed',
      params: { threadId: active.threadId, turnId: active.turnId, item: { id: 'm1', type: 'agentMessage', phase: 'final_answer', text: 'ok' } },
    })
    active.events.push({
      method: 'turn/completed',
      params: { threadId: active.threadId, turn: { id: active.turnId, status: 'completed' } },
    })
    let res = await pending
    while (!res.done) res = await iter.next()
  }

  // 3. temperature is rejected without purpose
  await assert.rejects(
    adapter.stream({ ...baseOptions, temperature: 0.7 } as any)[Symbol.asyncIterator]().next(),
    /App Server does not support DSH request field\(s\): temperature/,
  )

  // 4. temperature is rejected with purpose
  await assert.rejects(
    adapter.stream({ ...baseOptions, purpose: 'compaction', temperature: 0.7 } as any)[Symbol.asyncIterator]().next(),
    /App Server does not support DSH request field\(s\): temperature/,
  )

  // 5. stop is rejected without purpose
  await assert.rejects(
    adapter.stream({ ...baseOptions, stop: ['\n'] } as any)[Symbol.asyncIterator]().next(),
    /App Server does not support DSH request field\(s\): stop/,
  )

  // 6. stop is rejected with purpose
  await assert.rejects(
    adapter.stream({ ...baseOptions, purpose: 'session-title', stop: ['\n'] } as any)[Symbol.asyncIterator]().next(),
    /App Server does not support DSH request field\(s\): stop/,
  )
})

test('5. a purpose: "session-title" request succeeds while an ordinary request for the same session id is in flight, and neither trips the concurrency guard', async () => {
  const connection1 = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-primary', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-primary' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const connection2 = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-title', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-title' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }
  const connections = [connection1, connection2]
  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-concurrent-test', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  let connIdx = 0
  ;(adapter as any).openConnection = async () => connections[connIdx++]
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const primaryOptions = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-concurrent-test',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'primary' }] }],
  }
  const titleOptions = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-concurrent-test',
    purpose: 'session-title',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'title' }] }],
  }

  // 1. Start primary request
  const primaryIter = adapter.stream(primaryOptions as any)[Symbol.asyncIterator]()
  // Awaited below: this turn completes normally, unlike the ones in tests 6 and 7.
  const primaryPending = primaryIter.next()

  let primaryActive: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    primaryActive = (adapter as any).activeTurns.get('session-concurrent-test')
    if (primaryActive !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(primaryActive, 'primary turn must be active')
  assert.ok((adapter as any).inFlight.has('session-concurrent-test'), 'primary must be inFlight')

  // 2. Start title request while primary is in flight
  const titleIter = adapter.stream(titleOptions as any)[Symbol.asyncIterator]()
  const titlePending = titleIter.next()

  let titleActive: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    for (const [key, t] of (adapter as any).activeTurns.entries()) {
      if (key !== 'session-concurrent-test' && t.sessionId === 'session-concurrent-test') {
        titleActive = t
        break
      }
    }
    if (titleActive !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(titleActive, 'title turn must be active concurrently')

  // Complete title turn
  titleActive.events.push({
    method: 'item/completed',
    params: { threadId: titleActive.threadId, turnId: titleActive.turnId, item: { id: 'm-title', type: 'agentMessage', phase: 'final_answer', text: 'My Session Title' } },
  })
  titleActive.events.push({
    method: 'turn/completed',
    params: { threadId: titleActive.threadId, turn: { id: titleActive.turnId, status: 'completed' } },
  })

  const titleChunks: StreamChunk[] = []
  let titleRes = await titlePending
  while (!titleRes.done) {
    titleChunks.push(titleRes.value)
    titleRes = await titleIter.next()
  }
  const titleText = titleChunks.find(c => c.type === 'text-delta') as any
  assert.equal(titleText.text, 'My Session Title')

  // Primary turn is STILL inFlight and in activeTurns
  assert.ok((adapter as any).inFlight.has('session-concurrent-test'), 'primary must still be inFlight')
  assert.equal((adapter as any).activeTurns.get('session-concurrent-test'), primaryActive, 'primary active turn must still be registered')

  // Complete primary turn
  primaryActive.events.push({
    method: 'item/completed',
    params: {
      threadId: primaryActive.threadId,
      turnId: primaryActive.turnId,
      item: { id: 'm-primary', type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ decision: { kind: 'final', message: 'primary done' } }) },
    },
  })
  primaryActive.events.push({
    method: 'turn/completed',
    params: { threadId: primaryActive.threadId, turn: { id: primaryActive.turnId, status: 'completed' } },
  })

  const primaryChunks: StreamChunk[] = []
  let primaryRes = await primaryPending
  while (!primaryRes.done) {
    primaryChunks.push(primaryRes.value)
    primaryRes = await primaryIter.next()
  }
  const primaryText = primaryChunks.find(c => c.type === 'text-delta') as any
  assert.equal(primaryText.text, 'primary done')

  assert.equal((adapter as any).inFlight.has('session-concurrent-test'), false)
})

test('6. with a primary turn in flight and an auxiliary turn started and finished on the same session id, closeSession(sessionId) still finds and closes the primary turn', async () => {
  let primaryClosed = false
  let auxClosed = false

  const primaryConn = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-p', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-p' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { primaryClosed = true },
  }
  const auxConn = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-aux', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-aux' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { auxClosed = true },
  }

  const connections = [primaryConn, auxConn]
  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-reg-test', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  let connIdx = 0
  ;(adapter as any).openConnection = async () => connections[connIdx++]
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  // 1. Start primary turn
  const primaryIter = adapter.stream({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-reg-test',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'primary' }] }],
  } as any)[Symbol.asyncIterator]()
  // This step is deliberately still waiting when the turn is closed below, so
  // its rejection is expected. Observe it, or the runner reports an unhandled
  // rejection and fails the file even though every test passed.
  void primaryIter.next().catch(() => {})

  let primaryActive: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    primaryActive = (adapter as any).activeTurns.get('session-reg-test')
    if (primaryActive !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(primaryActive, 'primary turn must be active')

  // 2. Start and finish auxiliary turn on same sessionId
  const auxIter = adapter.stream({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-reg-test',
    purpose: 'compaction',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'aux' }] }],
  } as any)[Symbol.asyncIterator]()
  const auxPending = auxIter.next()

  let auxActive: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    for (const [key, t] of (adapter as any).activeTurns.entries()) {
      if (key !== 'session-reg-test' && t.sessionId === 'session-reg-test') {
        auxActive = t
        break
      }
    }
    if (auxActive !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(auxActive, 'aux turn must be registered')

  // Complete aux turn
  auxActive.events.push({
    method: 'item/completed',
    params: { threadId: auxActive.threadId, turnId: auxActive.turnId, item: { id: 'm-aux', type: 'agentMessage', phase: 'final_answer', text: 'aux finished' } },
  })
  auxActive.events.push({
    method: 'turn/completed',
    params: { threadId: auxActive.threadId, turn: { id: auxActive.turnId, status: 'completed' } },
  })

  let auxRes = await auxPending
  while (!auxRes.done) auxRes = await auxIter.next()

  // Aux turn is closed
  assert.equal(auxClosed, true, 'aux connection must be closed')
  // Primary connection is NOT closed yet!
  assert.equal(primaryClosed, false, 'primary connection must still be open')
  // Primary turn is STILL in activeTurns under sessionId!
  assert.equal((adapter as any).activeTurns.get('session-reg-test'), primaryActive, 'primary active turn must still be registered')

  // 3. Now closeSession('session-reg-test') is called
  adapter.closeSession('session-reg-test')

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (primaryClosed) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(primaryClosed, true, 'closeSession must find and close the primary turn')
  assert.equal((adapter as any).activeTurns.get('session-reg-test'), undefined, 'primary turn must be removed from activeTurns')
})

test('7. dispose() closes both an ordinary and an auxiliary turn', async () => {
  let primaryClosed = false
  let auxClosed = false

  const primaryConn = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-p', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-p' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { primaryClosed = true },
  }
  const auxConn = {
    async initialize() {},
    async request(method: string) {
      if (method === 'thread/start') return { thread: { id: 'thread-aux', turns: [] } }
      if (method === 'turn/start') return { turn: { id: 'turn-aux' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { auxClosed = true },
  }

  const connections = [primaryConn, auxConn]
  const ctx = {
    attachments: {},
    sessions: { get: () => ({ header: { id: 'session-dispose-test', cwd: '/workspace' } }) },
  }
  const adapter = new CodexAppServerAdapter(ctx as any, config)
  let connIdx = 0
  ;(adapter as any).openConnection = async () => connections[connIdx++]
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  // 1. Start primary turn
  const primaryIter = adapter.stream({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-dispose-test',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'primary' }] }],
  } as any)[Symbol.asyncIterator]()
  void primaryIter.next().catch(() => {})

  let primaryActive: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    primaryActive = (adapter as any).activeTurns.get('session-dispose-test')
    if (primaryActive !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(primaryActive, 'primary turn must be active')

  // 2. Start auxiliary turn
  const auxIter = adapter.stream({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-dispose-test',
    purpose: 'compaction',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'aux' }] }],
  } as any)[Symbol.asyncIterator]()
  void auxIter.next().catch(() => {})

  let auxActive: any
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    for (const [key, t] of (adapter as any).activeTurns.entries()) {
      if (key !== 'session-dispose-test' && t.sessionId === 'session-dispose-test') {
        auxActive = t
        break
      }
    }
    if (auxActive !== undefined) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(auxActive, 'aux turn must be registered')

  assert.equal((adapter as any).activeTurns.size, 2, 'activeTurns must hold both turns')

  // 3. Call dispose()
  await adapter.dispose()

  assert.equal(primaryClosed, true, 'primary connection must be closed by dispose()')
  assert.equal(auxClosed, true, 'auxiliary connection must be closed by dispose()')
  assert.equal((adapter as any).activeTurns.size, 0, 'activeTurns must be drained')
})
