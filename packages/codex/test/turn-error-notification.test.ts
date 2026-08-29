import assert from 'node:assert/strict'
import test from 'node:test'
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
  const { adapter, options } = fixture()

  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const first = iterator.next()

  const active = await waitForActiveTurn(adapter, 'session-a')
  active.events.push({
    kind: 'notification',
    notification: { method: 'error', params: { willRetry: false, error: { message: 'fatal marker without threadId' } } },
  })

  await assert.rejects(
    drainWithGuard(first, 2_000, 'the turn'),
    /fatal marker without threadId/,
  )
})

test('an error notification for a different, non-empty threadId is still ignored', async () => {
  const { adapter, options } = fixture()

  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const chunks: unknown[] = []
  let pending = iterator.next() // kicks off startTurn; awaited inside the drain loop below

  const active = await waitForActiveTurn(adapter, 'session-a')

  // A fatal-looking error for someone else's thread must not end this turn.
  active.events.push({
    kind: 'notification',
    notification: {
      method: 'error',
      params: { threadId: 'someone-elses-thread', willRetry: false, error: { message: 'must be ignored' } },
    },
  })
  // The real turn then completes normally.
  active.events.push({
    kind: 'notification',
    notification: {
      method: 'item/completed',
      params: {
        threadId: 'thread-a',
        turnId: 'turn-a',
        item: { type: 'agentMessage', id: 'msg-1', phase: null, text: 'final answer' },
      },
    },
  })
  active.events.push({
    kind: 'notification',
    notification: { method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } },
  })

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
})
