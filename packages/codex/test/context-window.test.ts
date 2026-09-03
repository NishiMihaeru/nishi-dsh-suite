import assert from 'node:assert/strict'
import test from 'node:test'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'

/**
 * The vendor's usable context window, and how this adapter comes to know it.
 *
 * Codex publishes the figure in exactly one place -- `modelContextWindow` on
 * `thread/tokenUsage/updated` -- so it cannot be had before a turn has run.
 * `model/list` has no such field and `config/read` exposes only the user's
 * override slot, which reads `null` until somebody sets it. These tests pin the
 * consequence: no context capacity is reported until the vendor discloses one,
 * and once it does, it is reported verbatim rather than adjusted.
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

function createFixture() {
  const connection = {
    async initialize() {},
    async request(method: string, _params: any) {
      if (method === 'thread/start') return { thread: { id: 'thread-test' } }
      if (method === 'turn/start') return { turn: { id: 'turn-test' } }
      if (method === 'account/read') return { requiresOpenaiAuth: false }
      if (method === 'model/list') {
        return {
          data: [{ id: 'gpt-5.6-sol', displayName: 'Sol', supportedReasoningEfforts: [], inputModalities: ['text'] }],
          nextCursor: null,
        }
      }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }

  const ctx = {
    attachments: {},
    sessions: {
      get: (id: string) => (id === 'session-test' ? { header: { cwd: '/workspace' } } : undefined),
    },
  }

  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({})

  const options = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-test',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }],
  } as any

  return { adapter, options }
}

async function waitForActiveTurn(adapter: any): Promise<any> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const active = adapter.activeTurns.get('session-test')
    if (active !== undefined) return active
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('test: active turn was never registered')
}

/** Run one turn whose usage notification carries `tokenUsage`. */
async function runTurnWith(adapter: any, options: any, tokenUsage: unknown): Promise<StreamChunk[]> {
  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const pending = iterator.next()
  const active = await waitForActiveTurn(adapter)
  active.events.push({
    method: 'thread/tokenUsage/updated',
    params: { threadId: 'thread-test', turnId: 'turn-test', tokenUsage },
  })
  active.events.push({
    method: 'item/completed',
    params: {
      threadId: 'thread-test',
      turnId: 'turn-test',
      item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer', text: 'done' },
    },
  })
  active.events.push({
    method: 'turn/completed',
    params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed' } },
  })
  const chunks: StreamChunk[] = []
  let result = await pending
  while (!result.done) {
    chunks.push(result.value)
    result = await iterator.next()
  }
  return chunks
}

const USAGE = {
  totalTokens: 15_297,
  inputTokens: 15_292,
  cachedInputTokens: 11_264,
  cacheWriteInputTokens: 0,
  outputTokens: 5,
  reasoningOutputTokens: 0,
}

test('1. before any turn has run, no context capacity is reported at all', async () => {
  const { adapter } = createFixture()
  const resolved = await adapter.resolveModel('codex-app-server', 'gpt-5.6-sol')
  assert.equal('context' in resolved, false, 'absence is legal and is the honest answer before the vendor discloses one')
})

test('2. the window the vendor publishes on a turn is what resolveModel reports afterwards', async () => {
  const { adapter, options } = createFixture()
  await runTurnWith(adapter, options, { last: USAGE, total: USAGE, modelContextWindow: 258_400 })

  const resolved = await adapter.resolveModel('codex-app-server', 'gpt-5.6-sol')
  // 258400 is what real `codex-cli 0.150.0` reported for every model in the
  // catalog: the raw 272000 window less the vendor's own 5% reserve. Reported
  // verbatim -- this adapter must not re-discount a figure already discounted.
  assert.deepEqual(resolved.context, { contextWindow: 258_400 })
})

test('3. a user override reaches DSH unchanged, because the vendor applies it before publishing', async () => {
  // Measured: `-c model_context_window=50000` makes the App Server publish
  // 47500. Reading the notification therefore honours `~/.codex/config.toml`
  // for free, which is why this package needs no context-window config key of
  // its own.
  const { adapter, options } = createFixture()
  await runTurnWith(adapter, options, { last: USAGE, total: USAGE, modelContextWindow: 47_500 })

  const resolved = await adapter.resolveModel('codex-app-server', 'gpt-5.6-sol')
  assert.deepEqual(resolved.context, { contextWindow: 47_500 })
})

test('4. a null or nonsense window is ignored rather than reported or thrown on', async () => {
  // The vendor's schema types `modelContextWindow` as nullable, so absence is
  // an expected value and not a protocol violation. A turn that carries none
  // must still complete.
  for (const window of [null, undefined, 0, -1, 1.5, '258400']) {
    const { adapter, options } = createFixture()
    const usage = window === undefined
      ? { last: USAGE, total: USAGE }
      : { last: USAGE, total: USAGE, modelContextWindow: window }
    const chunks = await runTurnWith(adapter, options, usage)
    assert.ok(
      chunks.some(chunk => chunk.type === 'finish'),
      `a turn carrying modelContextWindow ${JSON.stringify(window)} still completes`,
    )
    const resolved = await adapter.resolveModel('codex-app-server', 'gpt-5.6-sol')
    assert.equal('context' in resolved, false, `${JSON.stringify(window)} must not be reported as a window`)
  }
})

test('5. a model absent from the catalog still reports a window the vendor published for it', async () => {
  // The catalog can drop a model a caller still names; a window this adapter
  // watched the vendor publish for it is no less true for that, and the
  // unknown-model path used to discard it.
  const { adapter, options } = createFixture()
  await runTurnWith(adapter, { ...options, model: 'gpt-5.9-unlisted' }, {
    last: USAGE,
    total: USAGE,
    modelContextWindow: 400_000,
  })

  const resolved = await adapter.resolveModel('codex-app-server', 'gpt-5.9-unlisted')
  assert.equal(resolved.name, 'gpt-5.9-unlisted', 'still the unknown-model shape')
  assert.deepEqual(resolved.context, { contextWindow: 400_000 })
})

test('6. the window is remembered per model, not shared across them', async () => {
  const { adapter, options } = createFixture()
  await runTurnWith(adapter, options, { last: USAGE, total: USAGE, modelContextWindow: 258_400 })
  await runTurnWith(adapter, { ...options, model: 'gpt-5.4-mini' }, {
    last: USAGE,
    total: USAGE,
    modelContextWindow: 128_000,
  })

  assert.deepEqual((await adapter.resolveModel('codex-app-server', 'gpt-5.6-sol')).context, { contextWindow: 258_400 })
  assert.deepEqual((await adapter.resolveModel('codex-app-server', 'gpt-5.4-mini')).context, { contextWindow: 128_000 })
})
