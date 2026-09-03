import assert from 'node:assert/strict'
import test from 'node:test'
import { VendorFailure } from 'nishi-dsh-core/runtime'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'

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

function fixture() {
  const requests: string[] = []
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/start') return { thread: { id: 'thread-a' } }
      if (method === 'turn/start') return { turn: { id: 'turn-a' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }

  const ctx = {
    attachments: {},
    sessions: { get: (id: string) => (id === 'session-a' ? { header: { cwd: '/workspace' } } : undefined) },
  }

  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({})

  const options = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-a',
    messages: [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
    ],
  } as any

  return { adapter, requests, options }
}

/** Poll until an active turn is registered for the session, without a real timer-based race. */
async function waitForActiveTurn(adapter: any, sessionId: string): Promise<any> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const active = adapter.activeTurns.get(sessionId)
    if (active !== undefined) return active
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('test: active turn was never registered')
}

async function drainWithGuard<T>(promise: Promise<T>, guardMs: number, label: string): Promise<T> {
  const guard = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`test: ${label} did not settle within ${guardMs}ms`)), guardMs)
    timer.unref?.()
  })
  return Promise.race([promise, guard])
}

test('an error notification without a threadId fails the turn immediately instead of waiting for turnTimeoutMs', async () => {
  const SECRET = '/home/secret-user/private/path'
  const { adapter, options } = fixture()

  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const first = iterator.next()

  const active = await waitForActiveTurn(adapter, 'session-a')
  active.events.push({ method: 'error', params: { willRetry: false, error: { message: `fatal marker without threadId ${SECRET}` } } })

  await assert.rejects(
    drainWithGuard(first, 2_000, 'the turn'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: unknown }).code, 'CODEX_APP_SERVER')
      // Promptness is the real contract here: the turn must fail immediately
      // rather than hang until turnTimeoutMs. The vendor's own words must
      // not reach the caller -- only a VendorFailure, attached as `cause`.
      assert.doesNotMatch(error.message, /fatal marker without threadId/)
      assert.doesNotMatch(error.message, /secret-user/)
      assert.ok(error.cause instanceof VendorFailure, 'the failure must carry a VendorFailure as cause')
      return true
    },
  )
})

test('an error notification for a different, non-empty threadId is still ignored', async () => {
  const { adapter, options } = fixture()

  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const chunks: unknown[] = []
  let pending = iterator.next() // kicks off startTurn; awaited inside the drain loop below

  const active = await waitForActiveTurn(adapter, 'session-a')

  active.events.push({
    method: 'error',
    params: { threadId: 'someone-elses-thread', willRetry: false, error: { message: 'must be ignored' } },
  })
  // The real turn then completes normally.
  active.events.push({
    method: 'item/completed',
    params: {
      threadId: 'thread-a',
      turnId: 'turn-a',
      item: { type: 'agentMessage', id: 'msg-1', phase: null, text: JSON.stringify({ decision: { kind: 'final', message: 'final answer' } }) },
    },
  })
  active.events.push({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } })

  for (;;) {
    const { value, done } = await drainWithGuard(pending, 2_000, 'the turn')
    if (done) break
    chunks.push(value)
    pending = iterator.next()
  }

  assert.ok(
    chunks.some(chunk => (chunk as any).type === 'finish' && (chunk as any).reason?.kind === 'stop'),
    'the turn must complete normally once the foreign-thread error is correctly ignored',
  )
  assert.ok(
    !JSON.stringify(chunks).includes('must be ignored'),
    'the other thread\'s vendor error text must never reach the caller, ignored or not',
  )
})

test('a failed turn reports the status without copying the vendor error text', async () => {
  const SECRET = '/home/secret-user/private/path'
  const TOKEN = 'sk_fake_9f8e7d6c5b4a3210'
  const { adapter, options } = fixture()

  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const first = iterator.next()

  const active = await waitForActiveTurn(adapter, 'session-a')
  active.events.push({
    method: 'turn/completed',
    params: {
      threadId: 'thread-a',
      turn: {
        id: 'turn-a',
        status: 'failed',
        error: { message: `disk full while writing ${SECRET} token=${TOKEN}` },
      },
    },
  })

  await assert.rejects(
    drainWithGuard(first, 2_000, 'the failed turn'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /status failed/)
      // The vendor authored this string; it must not reach the caller.
      assert.doesNotMatch(error.message, /secret-user/)
      assert.doesNotMatch(error.message, /sk_fake/)
      assert.doesNotMatch(error.message, /disk full/)
      return true
    },
  )
})

test('a retrying error is ignored twice and fails the turn on the third', async () => {
  const { adapter, options } = fixture()
  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const first = iterator.next()
  const active = await waitForActiveTurn(adapter, 'session-a')

  const retrying = { method: 'error', params: { willRetry: true, error: { message: 'transient' } } }
  active.events.push(retrying)
  active.events.push(retrying)
  active.events.push(retrying)

  await assert.rejects(
    drainWithGuard(first, 2_000, 'the retry-capped turn'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: unknown }).code, 'CODEX_APP_SERVER')
      assert.doesNotMatch(error.message, /transient/)
      return true
    },
  )
})

test('two retrying errors still let a later successful turn complete', async () => {
  const { adapter, options } = fixture()
  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const chunks: unknown[] = []
  let pending = iterator.next()
  const active = await waitForActiveTurn(adapter, 'session-a')

  active.events.push({ method: 'error', params: { willRetry: true, error: { message: 'blip-1' } } })
  active.events.push({ method: 'error', params: { willRetry: true, error: { message: 'blip-2' } } })
  active.events.push({
    method: 'item/completed',
    params: {
      threadId: 'thread-a',
      turnId: 'turn-a',
      item: { type: 'agentMessage', id: 'msg-1', phase: null, text: JSON.stringify({ decision: { kind: 'final', message: 'recovered' } }) },
    },
  })
  active.events.push({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } })

  for (;;) {
    const { value, done } = await drainWithGuard(pending, 2_000, 'the recovered turn')
    if (done) break
    chunks.push(value)
    pending = iterator.next()
  }

  assert.ok(
    chunks.some(chunk => (chunk as any).type === 'finish' && (chunk as any).reason?.kind === 'stop'),
    'two ignored retries must not prevent a later successful completion',
  )
})
