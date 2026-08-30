import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { AntigravitySearchBackend } from '../src/web-search-backend.ts'

/**
 * Regression net for the vendor's own `--sandbox` flag (agy `--help`:
 * "Run in a sandbox with terminal restrictions enabled"), added as a
 * preventive layer alongside the `finish`-only tool allowlist in front of
 * the post-hoc `BLOCKED_NATIVE_TOOLS` backstop (see native-tool-block.test.ts).
 *
 * `--sandbox` is a boolean flag (unlike Codex's `--sandbox read-only`), so
 * these tests only assert its presence in the argv actually handed to
 * `ctx.subprocess.spawn()` -- not any particular position or value.
 */

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

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line no-unused-vars
  for await (const _chunk of iterable) { /* consume to completion */ }
}

test('the primary turn invocation passes --sandbox to the vendor CLI', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        capturedArgv = spec.argv
        return streamingChild({ lines: [], stderr: '', exitCode: 1 })
      },
    },
  } as any
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'spawn was called')
  assert.ok(capturedArgv!.includes('--sandbox'), `expected --sandbox in argv: ${JSON.stringify(capturedArgv)}`)
})

test('the web-search backend invocation passes --sandbox to the vendor CLI', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        capturedArgv = spec.argv
        return streamingChild({ lines: [], stderr: '', exitCode: 1 })
      },
    },
  } as any
  const backend = new AntigravitySearchBackend(ctx, searchConfig)

  await assert.rejects(
    backend.search({ provider: 'antigravity-cli', model: 'gemini-1.5-pro' }, { query: 'q', maxResults: 3 }, AbortSignal.timeout(5_000)),
  )

  assert.ok(capturedArgv, 'spawn was called')
  assert.ok(capturedArgv!.includes('--sandbox'), `expected --sandbox in argv: ${JSON.stringify(capturedArgv)}`)
})
