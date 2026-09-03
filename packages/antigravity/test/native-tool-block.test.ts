import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { noopQuotaHarvestCache } from '../src/quota-harvest-cache.ts'
import { stampedLine } from './turn-stamp.ts'
import { isVersionSpawn, versionChild } from './fake-vendor.ts'

/**
 * Regression net for the primary native-tool allowlist (`finish` only).
 * Checked in `stream()` after `runTurn()` resolves. This is a backstop, not
 * prevention: it inspects an already-collected event stream after the vendor
 * CLI has already run the tool. It sits behind the `finish`-only agent
 * markdown and `--sandbox`. A name that is not `finish` fails the step,
 * including one the vendor has not used before.
 */

const config = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 1_000,
  stderrMaxBytes: 64_000,
}

/** A stream-json managed child: writes `lines` to stdout, then exits with `exitCode`/`stderr`. */
function streamingChild(opts: { lines?: readonly string[]; stderr?: string; exitCode?: number | null; streaming?: boolean }) {
  const { lines = [], stderr = '', exitCode = 0, streaming = true } = opts
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  // A turn child answers the line it was given rather than emitting on a
  // timer, because its reply has to echo that envelope's turn stamp and the
  // stamp is only knowable from the line. A one-shot collected call -- the
  // model catalog -- is handed no stdin at all and must not wait for one.
  const emit = (inputLine: string) => {
    for (const line of lines) stdout.write(`${stampedLine(line, inputLine)}\n`)
    stdout.end()
    done.resolve({ exitCode, signal: null })
  }
  if (streaming) {
    let answered = false
    stdin.on('data', chunk => {
      if (answered) return
      answered = true
      emit(String(chunk))
    })
  } else {
    stdin.on('data', () => {})
    queueMicrotask(() => { emit('') })
  }
  return {
    pid: 3000,
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

function turnCtx(streamOpts: { lines?: readonly string[]; stderr?: string; exitCode?: number | null }) {
  return {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (isVersionSpawn(spec.argv)) return versionChild()
        return streamingChild({ ...streamOpts, streaming: spec.argv.includes('--input-format') })
      },
    },
  } as any
}

function successResultLine(): string {
  return JSON.stringify({
    event: 'result',
    result: { status: 'SUCCESS', structured_output: { kind: 'message', text: 'hi', tool_calls: [] } },
  })
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('a turn whose event stream reports a blocked native tool raises ANTIGRAVITY_NATIVE_TOOL naming it', async () => {
  const lines = [
    JSON.stringify({ step_update: { step_type: 'tool', tool_name: 'run_command' } }),
    successResultLine(),
  ]
  const ctx = turnCtx({ lines })
  const adapter = new AntigravityCliAdapter(ctx, config, noopQuotaHarvestCache())
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_NATIVE_TOOL')
    assert.match(error.message, /run_command/)
    return true
  })
})

test('a turn whose event stream reports multiple blocked native tools names all of them', async () => {
  const lines = [
    JSON.stringify({ step_update: { step_type: 'tool', tool_name: 'run_command' } }),
    JSON.stringify({ step_update: { step_type: 'tool', tool_name: 'write_file' } }),
    successResultLine(),
  ]
  const ctx = turnCtx({ lines })
  const adapter = new AntigravityCliAdapter(ctx, config, noopQuotaHarvestCache())
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_NATIVE_TOOL')
    assert.match(error.message, /run_command/)
    assert.match(error.message, /write_file/)
    return true
  })
})

test('a turn using only allowed tools does not raise ANTIGRAVITY_NATIVE_TOOL', async () => {
  const lines = [
    JSON.stringify({ step_update: { step_type: 'tool', tool_name: 'finish' } }),
    successResultLine(),
  ]
  const ctx = turnCtx({ lines })
  const adapter = new AntigravityCliAdapter(ctx, config, noopQuotaHarvestCache())
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(
    chunks.some((chunk: any) => chunk.type === 'finish' && chunk.reason?.kind === 'stop'),
    'the turn must complete normally when no blocked native tool was invoked',
  )
})

test('a turn with no tool activity at all does not raise ANTIGRAVITY_NATIVE_TOOL', async () => {
  const ctx = turnCtx({ lines: [successResultLine()] })
  const adapter = new AntigravityCliAdapter(ctx, config, noopQuotaHarvestCache())
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(chunks.some((chunk: any) => chunk.type === 'finish' && chunk.reason?.kind === 'stop'))
})

test('a native tool the denylist never named still fails the turn', async () => {
  const lines = [
    JSON.stringify({ step_update: { step_type: 'tool', tool_name: 'brand_new_vendor_tool' } }),
    successResultLine(),
  ]
  const ctx = turnCtx({ lines })
  const adapter = new AntigravityCliAdapter(ctx, config, noopQuotaHarvestCache())
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_NATIVE_TOOL')
    assert.match(error.message, /brand_new_vendor_tool/)
    return true
  })
})
