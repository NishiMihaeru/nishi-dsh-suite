import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { AntigravitySearchBackend, AntigravityWebSearchBackendError } from '../src/web-search-backend.ts'

/**
 * Regression net for the four sites that forward raw vendor stdio to a
 * caller today:
 *   - web-search-backend.ts:227  (exited before a result event -> bounded(stderr))
 *   - web-search-backend.ts:242  (status !== SUCCESS -> bounded(result.error))
 *   - antigravity-primary.ts:550 (model discovery failure -> stripAnsi(stderr || stdout))
 *   - antigravity-primary.ts:751 (turn exited before a result event -> raw stderr, unbounded)
 *
 * A change queued right behind this suite routes all four through Core's
 * `VendorFailure` sanitization contract. Every test here drives a failing
 * vendor run whose stderr/error carries an unmistakable marker, asserts the
 * error type/code a caller actually receives, and then asserts -- as a
 * CHARACTERIZATION -- that the raw marker currently leaks into the message.
 * The sanitization change is expected to invert only the CHARACTERIZATION
 * assertions; the type/code assertions must keep passing unchanged.
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

test('B1 (web-search-backend.ts:227): a search exiting before a result event surfaces WEB_SEARCH_PROVIDER_ERROR', async () => {
  const ctx = turnCtx({ lines: [], stderr: MARKER, exitCode: 1 })
  const backend = new AntigravitySearchBackend(ctx, searchConfig)

  await assert.rejects(
    backend.search({ provider: 'antigravity-cli', model: 'gemini-1.5-pro' }, { query: 'q', maxResults: 3 }, AbortSignal.timeout(5_000)),
    (error: unknown) => {
      assert.ok(error instanceof AntigravityWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR')
      // CHARACTERIZATION: raw vendor stderr, including the secret path and
      // fake token, reaches the caller today. Expected to invert once
      // VendorFailure sanitization lands.
      assert.match(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
      assert.match(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
      return true
    },
  )
})

// --- web-search-backend.ts:242 ------------------------------------------

test('B2 (web-search-backend.ts:242): status !== SUCCESS surfaces WEB_SEARCH_PROVIDER_ERROR', async () => {
  const resultLine = JSON.stringify({ event: 'result', result: { status: 'FAILED', error: MARKER } })
  const ctx = turnCtx({ lines: [resultLine], stderr: '', exitCode: 0 })
  const backend = new AntigravitySearchBackend(ctx, searchConfig)

  await assert.rejects(
    backend.search({ provider: 'antigravity-cli', model: 'gemini-1.5-pro' }, { query: 'q', maxResults: 3 }, AbortSignal.timeout(5_000)),
    (error: unknown) => {
      assert.ok(error instanceof AntigravityWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR')
      // CHARACTERIZATION: raw result.error, including the secret path and
      // fake token, reaches the caller today. Expected to invert once
      // VendorFailure sanitization lands.
      assert.match(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
      assert.match(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
      return true
    },
  )
})

// --- antigravity-primary.ts:550 -----------------------------------------

test('B3 (antigravity-primary.ts:550): model discovery failure surfaces ANTIGRAVITY_CLI', async () => {
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 }, // JSON path fails -> forces the text fallback
    { stdout: '', stderr: MARKER, exitCode: 1 }, // text fallback also fails
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)

  await assert.rejects(adapter.listModels('antigravity-cli'), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    // CHARACTERIZATION: raw vendor stderr, including the secret path and
    // fake token, reaches the caller today. Expected to invert once
    // VendorFailure sanitization lands.
    assert.match(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
    assert.match(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
    return true
  })
})

// --- antigravity-primary.ts:751 -----------------------------------------

test('B4 (antigravity-primary.ts:751): a turn exiting before a result event surfaces ANTIGRAVITY_CLI, with raw stderr and no truncation at all', async () => {
  const hugeMarker = `${MARKER} ${'x'.repeat(200_000)}`
  const ctx = turnCtx({ lines: [], stderr: hugeMarker, exitCode: 1 })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    // CHARACTERIZATION: raw vendor stderr reaches the caller today, and
    // unlike the other three sites it is not even bounded/truncated first
    // -- the entire (here, 200KB+) stderr text is appended verbatim. Expected
    // to invert (both the leak and the lack of any bound) once VendorFailure
    // sanitization lands.
    assert.match(error.message, new RegExp(escapeRegExp(SECRET_PATH)))
    assert.match(error.message, new RegExp(escapeRegExp(FAKE_TOKEN)))
    assert.ok(error.message.length > 200_000, 'the raw stderr is forwarded with no truncation at all')
    return true
  })
})
