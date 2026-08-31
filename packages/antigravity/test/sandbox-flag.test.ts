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
  // Pinned: these assert the forced-schema transport. The package default is
  // `mcp-bridge`, which would send them down a path they are not about.
  transport: 'schema' as const,
}

const searchConfig = {
  executable: 'agy',
  env: {},
  timeoutMs: 5_000,
  disposeGraceMs: 1_000,
  stderrMaxBytes: 64_000,
  // Pinned: these assert the forced-schema transport. The package default is
  // `mcp-bridge`, which would send them down a path they are not about.
  transport: 'schema' as const,
}

const DEFAULT_MOCK_CATALOG = [
  'gemini-1.5-pro\tGemini 1.5 Pro',
  'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
  'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
  'custom-model-high\tCustom Model (High)',
].join('\n')

/** A stream-json / collected managed child: writes `lines` to stdout, then exits with `exitCode`/`stderr`. */
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
  const stdoutText = lines.map(l => `${l}\n`).join('')
  return {
    pid: 2000,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdoutText, nextOffset: stdoutText.length, lossy: false } } },
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

function createPrimarySubprocessMock(onTurnSpawn: (argv: readonly string[]) => void, catalogResponse = DEFAULT_MOCK_CATALOG) {
  return {
    async resolveExecutable() { return '/resolved/agy' },
    spawn(spec: { argv: readonly string[] }) {
      if (spec.argv.includes('models')) {
        return streamingChild({
          lines: [
            'Fetching available models...',
            JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: catalogResponse }),
          ],
          exitCode: 0,
        })
      }
      onTurnSpawn(spec.argv)
      return streamingChild({ lines: [], stderr: '', exitCode: 1 })
    },
  }
}

test('the primary turn invocation passes --sandbox to the vendor CLI', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: createPrimarySubprocessMock(argv => {
      capturedArgv = argv
    }),
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

test('argv mapping: base model gemini-3.7-flash + reasoningEffort high passes --model gemini-3.7-flash and --effort high', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: createPrimarySubprocessMock(argv => {
      capturedArgv = argv
    }),
  } as any
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-3.7-flash', reasoningEffort: 'high', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'spawn was called for turn')
  const modelIdx = capturedArgv!.indexOf('--model')
  assert.notEqual(modelIdx, -1, 'expected --model in argv')
  assert.equal(capturedArgv![modelIdx + 1], 'gemini-3.7-flash')

  const effortIdx = capturedArgv!.indexOf('--effort')
  assert.notEqual(effortIdx, -1, 'expected --effort in argv')
  assert.equal(capturedArgv![effortIdx + 1], 'high')
})

test('argv mapping: legacy gemini-3.7-flash-low without explicit effort passes base model and effort low', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: createPrimarySubprocessMock(argv => {
      capturedArgv = argv
    }),
  } as any
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  await adapter.resolveModel('antigravity-cli', 'gemini-3.7-flash-low')
  const options = { provider: 'antigravity-cli', model: 'gemini-3.7-flash-low', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'spawn was called for turn')
  const modelIdx = capturedArgv!.indexOf('--model')
  assert.notEqual(modelIdx, -1, 'expected --model in argv')
  assert.equal(capturedArgv![modelIdx + 1], 'gemini-3.7-flash')

  const effortIdx = capturedArgv!.indexOf('--effort')
  assert.notEqual(effortIdx, -1, 'expected --effort in argv')
  assert.equal(capturedArgv![effortIdx + 1], 'low')
})

test('argv mapping: legacy low + explicit high passes base model and effort high', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: createPrimarySubprocessMock(argv => {
      capturedArgv = argv
    }),
  } as any
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  await adapter.resolveModel('antigravity-cli', 'gemini-3.7-flash-low')
  const options = { provider: 'antigravity-cli', model: 'gemini-3.7-flash-low', reasoningEffort: 'high', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'spawn was called for turn')
  const modelIdx = capturedArgv!.indexOf('--model')
  assert.notEqual(modelIdx, -1, 'expected --model in argv')
  assert.equal(capturedArgv![modelIdx + 1], 'gemini-3.7-flash')

  const effortIdx = capturedArgv!.indexOf('--effort')
  assert.notEqual(effortIdx, -1, 'expected --effort in argv')
  assert.equal(capturedArgv![effortIdx + 1], 'high')
})

test('argv mapping: single custom-model-high without sibling variants leaves custom-model-high and does not add inferred effort', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: createPrimarySubprocessMock(argv => {
      capturedArgv = argv
    }),
  } as any
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  await adapter.resolveModel('antigravity-cli', 'custom-model-high')
  const options = { provider: 'antigravity-cli', model: 'custom-model-high', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'spawn was called for turn')
  const modelIdx = capturedArgv!.indexOf('--model')
  assert.notEqual(modelIdx, -1, 'expected --model in argv')
  assert.equal(capturedArgv![modelIdx + 1], 'custom-model-high')

  assert.equal(capturedArgv!.includes('--effort'), false, `expected no --effort in argv: ${JSON.stringify(capturedArgv)}`)
})

test('argv mapping: a legacy id maps without a prior catalog call, so an expired cache cannot send a contradictory pair', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: createPrimarySubprocessMock(argv => {
      capturedArgv = argv
    }),
  } as any
  // Nothing warms the catalog first: this is a turn taken on a cold adapter,
  // or after `modelCacheMs` expired between route resolution and the turn.
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = {
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-low',
    reasoningEffort: 'high',
    messages: [],
  } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'spawn was called for turn')
  const modelIdx = capturedArgv!.indexOf('--model')
  assert.equal(capturedArgv![modelIdx + 1], 'gemini-3.7-flash')
  const effortIdx = capturedArgv!.indexOf('--effort')
  assert.equal(capturedArgv![effortIdx + 1], 'high')
})

test('argv mapping: catalog discovery failure invokes the requested id rather than losing the turn', async () => {
  let capturedArgv: readonly string[] | undefined
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        // Discovery fails; the turn itself must still reach the vendor.
        if (spec.argv.includes('models')) {
          return streamingChild({ lines: [], stderr: 'catalog unavailable', exitCode: 1 })
        }
        capturedArgv = spec.argv
        return streamingChild({ lines: [], stderr: '', exitCode: 1 })
      },
    },
  } as any
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = {
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-low',
    reasoningEffort: 'medium',
    messages: [],
  } as any

  await assert.rejects(drain(adapter.stream(options)))

  assert.ok(capturedArgv, 'the turn must still be spawned when discovery fails')
  const modelIdx = capturedArgv!.indexOf('--model')
  assert.equal(capturedArgv![modelIdx + 1], 'gemini-3.7-flash-low')
  const effortIdx = capturedArgv!.indexOf('--effort')
  assert.equal(capturedArgv![effortIdx + 1], 'medium')
})
