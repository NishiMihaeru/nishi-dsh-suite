import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { VendorFailure } from 'nishi-dsh-core/runtime'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { AntigravitySearchBackend, AntigravityWebSearchBackendError } from '../src/web-search-backend.ts'

/**
 * Regression net for the five sites that used to forward raw vendor stdio to
 * a caller:
 *   - web-search-backend.ts  (exited before a result event -> antigravityVendorFailure, stage 'web-search-exit')
 *   - web-search-backend.ts  (status !== SUCCESS -> antigravityVendorFailure, stage 'web-search')
 *   - antigravity-primary.ts (model discovery failure -> antigravityVendorFailure, stage 'model-discovery')
 *   - antigravity-primary.ts (turn exited before a result event -> antigravityVendorFailure, stage 'turn')
 *   - antigravity-primary.ts (resultFailure(): an ordinary turn result reporting
 *     status !== SUCCESS -> antigravityVendorFailure, stage 'turn')
 *
 * All five now route through Core's `VendorFailure` sanitization contract
 * (see ../src/vendor-stderr.ts). Every test here drives a failing vendor run
 * whose stderr/error carries an unmistakable marker, asserts the error
 * type/code a caller actually receives (unchanged from before), and then
 * asserts that the raw marker is ABSENT from the resulting message -- only a
 * recognised, caller-authored sentence or an unattributed category plus safe
 * exit/signal metadata may appear.
 */

const SECRET_PATH = '/home/secret-user/private/path'
const FAKE_TOKEN = 'agy_fake_sk_9f8e7d6c5b4a3210'
const MARKER = `${SECRET_PATH} token=${FAKE_TOKEN}`

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const primaryConfig = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 1_000,
  stderrMaxBytes: 64_000,
}

const searchConfig = {
  executable: 'agy',
  env: {},
  timeoutMs: 5_000,
  disposeGraceMs: 1_000,
  stderrMaxBytes: 64_000,
}

/** A `runCollected`-shaped managed child: exits immediately with collected stdout/stderr. */
function collectedChild(stdout: string, stderr: string, exitCode: number | null = 0) {
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => done.resolve({ exitCode, signal: null }))
  return {
    pid: 1000,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdout, nextOffset: stdout.length, lossy: false } } },
      stderr: { readFrom() { return { text: stderr, nextOffset: stderr.length, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

/** A stream-json managed child: writes `lines` to stdout, then exits with `exitCode`/`stderr`. */
function streamingChild(opts: { lines?: readonly string[]; stderr?: string; exitCode?: number | null }) {
  const { lines = [], stderr = '', exitCode = 0 } = opts
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  stdin.on('data', () => {})
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => {
    for (const line of lines) stdout.write(`${line}\n`)
    stdout.end()
    done.resolve({ exitCode, signal: null })
  })
  return {
    pid: 2000,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stderr: { readFrom() { return { text: stderr, nextOffset: stderr.length, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

function modelCatalogCtx(responses: ReadonlyArray<{ stdout: string; stderr: string; exitCode?: number | null }>) {
  let call = 0
  return {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn() {
        const response = responses[call] ?? responses[responses.length - 1]
        call += 1
        return collectedChild(response.stdout, response.stderr, response.exitCode ?? 0)
      },
    },
  } as any
}

function turnCtx(streamOpts: { lines?: readonly string[]; stderr?: string; exitCode?: number | null }) {
  return {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn() { return streamingChild(streamOpts) },
    },
  } as any
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line no-unused-vars
  for await (const _chunk of iterable) { /* consume to completion */ }
}

// --- web-search-backend.ts:227 ------------------------------------------

test('B1 (web-search-backend.ts, stage web-search-exit): a search exiting before a result event surfaces WEB_SEARCH_PROVIDER_ERROR with no vendor text', async () => {
  const ctx = turnCtx({ lines: [], stderr: MARKER, exitCode: 1 })
  const backend = new AntigravitySearchBackend(ctx, searchConfig)

  await assert.rejects(
    backend.search({ provider: 'antigravity-cli', model: 'gemini-1.5-pro' }, { query: 'q', maxResults: 3 }, AbortSignal.timeout(5_000)),
    (error: unknown) => {
      assert.ok(error instanceof AntigravityWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR')
      // The secret path and fake token are unrecognised vendor stderr and must
      // never reach the message -- only VendorFailure's sanitised category text may.
      assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
      assert.doesNotMatch(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
      assert.ok(error.message.length < 500, 'message stays small')
      assert.ok(error.cause instanceof VendorFailure)
      assert.equal(error.cause.stage, 'web-search-exit')
      assert.equal(error.cause.category, 'unrecognized')
      assert.equal(error.cause.exitCode, 1)
      return true
    },
  )
})

// --- web-search-backend.ts:242 ------------------------------------------

test('B2 (web-search-backend.ts, stage web-search): status !== SUCCESS surfaces WEB_SEARCH_PROVIDER_ERROR with no vendor text', async () => {
  const resultLine = JSON.stringify({ event: 'result', result: { status: 'FAILED', error: MARKER } })
  const ctx = turnCtx({ lines: [resultLine], stderr: '', exitCode: 0 })
  const backend = new AntigravitySearchBackend(ctx, searchConfig)

  await assert.rejects(
    backend.search({ provider: 'antigravity-cli', model: 'gemini-1.5-pro' }, { query: 'q', maxResults: 3 }, AbortSignal.timeout(5_000)),
    (error: unknown) => {
      assert.ok(error instanceof AntigravityWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR')
      // result.error is vendor-authored application text -- treated the same as
      // stderr for sanitisation. The secret path and fake token must not leak.
      assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
      assert.doesNotMatch(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
      assert.ok(error.message.length < 500, 'message stays small')
      assert.ok(error.cause instanceof VendorFailure)
      assert.equal(error.cause.stage, 'web-search')
      assert.equal(error.cause.category, 'unrecognized')
      return true
    },
  )
})

// --- antigravity-primary.ts:550 -----------------------------------------

test('B3 (antigravity-primary.ts, stage model-discovery): model discovery failure surfaces ANTIGRAVITY_CLI with no vendor text', async () => {
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 }, // JSON path fails -> forces the text fallback
    { stdout: '', stderr: MARKER, exitCode: 1 }, // text fallback also fails
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)

  await assert.rejects(adapter.listModels('antigravity-cli'), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    // The secret path and fake token are unrecognised vendor stderr and must
    // never reach the message -- only VendorFailure's sanitised category text may.
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
    assert.ok(error.message.length < 500, 'message stays small')
    assert.ok(error.cause instanceof VendorFailure)
    assert.equal(error.cause.stage, 'model-discovery')
    assert.equal(error.cause.category, 'unrecognized')
    assert.equal(error.cause.exitCode, 1)
    return true
  })
})

// --- antigravity-primary.ts:751 -----------------------------------------

test('B4 (antigravity-primary.ts, stage turn): a turn exiting before a result event surfaces ANTIGRAVITY_CLI, with no vendor text and a small message', async () => {
  const hugeMarker = `${MARKER} ${'x'.repeat(200_000)}`
  const ctx = turnCtx({ lines: [], stderr: hugeMarker, exitCode: 1 })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    // Unlike before, the entire (here, 200KB+) stderr payload -- including
    // the secret path and fake token -- must never reach the message, and the
    // message must stay small regardless of how large the vendor stderr was.
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
    assert.ok(error.message.length < 500, 'the message stays small no matter how large the vendor stderr was')
    assert.ok(error.cause instanceof VendorFailure)
    assert.equal(error.cause.stage, 'turn')
    assert.equal(error.cause.category, 'unrecognized')
    assert.equal(error.cause.exitCode, 1)
    return true
  })
})

// --- antigravity-primary.ts: resultFailure() -----------------------------

test('C1 (antigravity-primary.ts, resultFailure, stage turn): an ordinary turn result reporting failure surfaces ANTIGRAVITY_CLI with no vendor text', async () => {
  const resultLine = JSON.stringify({ event: 'result', result: { status: 'FAILED', error: MARKER } })
  const ctx = turnCtx({ lines: [resultLine], stderr: '', exitCode: 0 })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    // result.error is vendor-authored free text carried in the structured
    // result rather than stderr -- the secret path and fake token planted in
    // it must never reach the message, only the sanitised category text and
    // the safe, caller-controlled status enum may.
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
    assert.ok(error.message.length < 500, 'message stays small')
    assert.match(error.message, /status FAILED/)
    assert.ok(error.cause instanceof VendorFailure)
    assert.equal(error.cause.stage, 'turn')
    assert.equal(error.cause.category, 'unrecognized')
    return true
  })
})

// --- recognizer coverage: network-unavailable ---------------------------

test('network-unavailable recognizer authors its own message and drops the surrounding vendor text', async () => {
  const stderr = `connect failed: ECONNREFUSED at ${SECRET_PATH} token=${FAKE_TOKEN}`
  const ctx = turnCtx({ lines: [], stderr, exitCode: 1 })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    assert.ok(error.cause instanceof VendorFailure)
    assert.equal(error.cause.category, 'network-unavailable')
    assert.match(error.message, /could not reach the network \(ECONNREFUSED\)/)
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
    return true
  })
})

test('network-unavailable recognizer also fires for the web-search backend', async () => {
  const stderr = `lookup failed: EAI_AGAIN at ${SECRET_PATH}`
  const ctx = turnCtx({ lines: [], stderr, exitCode: 1 })
  const backend = new AntigravitySearchBackend(ctx, searchConfig)

  await assert.rejects(
    backend.search({ provider: 'antigravity-cli', model: 'gemini-1.5-pro' }, { query: 'q', maxResults: 3 }, AbortSignal.timeout(5_000)),
    (error: unknown) => {
      assert.ok(error instanceof AntigravityWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR')
      assert.ok(error.cause instanceof VendorFailure)
      assert.equal(error.cause.category, 'network-unavailable')
      assert.match(error.message, /could not reach the network \(EAI_AGAIN\)/)
      assert.doesNotMatch(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
      return true
    },
  )
})

// --- recognizer coverage: model-unsupported ------------------------------

const REAL_MODEL_UNSUPPORTED_STDERR =
  'Error: invalid model selection (--model "definitely-not-a-model" --effort ""): ' +
  'model definitely-not-a-model is not recognized as a known model or custom model in settings'

test('model-unsupported recognizer authors its own message for the confirmed real CLI wording (model discovery)', async () => {
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: '', stderr: REAL_MODEL_UNSUPPORTED_STDERR, exitCode: 1 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)

  await assert.rejects(adapter.listModels('antigravity-cli'), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    assert.ok(error.cause instanceof VendorFailure)
    assert.equal(error.cause.category, 'model-unsupported')
    assert.match(error.message, /rejected the requested model or reasoning effort as unsupported/)
    // The vendor's own wording (the invalid model name, the quoted flags) must not leak.
    assert.doesNotMatch(error.message, /definitely-not-a-model/)
    assert.doesNotMatch(error.message, /--effort/)
    return true
  })
})

test('model-unsupported recognizer also fires at the turn-exit site when no reasoningEffort was requested', async () => {
  const ctx = turnCtx({ lines: [], stderr: REAL_MODEL_UNSUPPORTED_STDERR, exitCode: 1 })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  // No reasoningEffort set, so the earlier effort-unsupported branch (UNSUPPORTED
  // code) is skipped entirely and this falls through to the generic VendorFailure path.
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    assert.ok(error.cause instanceof VendorFailure)
    assert.equal(error.cause.category, 'model-unsupported')
    assert.match(error.message, /rejected the requested model or reasoning effort as unsupported/)
    assert.doesNotMatch(error.message, /definitely-not-a-model/)
    return true
  })
})
