import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'

/**
 * Regression net for `BLOCKED_NATIVE_TOOLS` (antigravity-primary.ts:58),
 * checked in `stream()` right after `runTurn()` resolves
 * (antigravity-primary.ts:499). This check is a backstop, not prevention: it
 * inspects the turn's already-collected event stream for a blocked native
 * tool invocation after the vendor CLI has already run it. It sits behind
 * two preventive layers -- the `finish`-only tool allowlist declared in the
 * bridge agent markdown, and the vendor's own `--sandbox` terminal
 * restrictions passed to every turn invocation -- and exists in case either
 * of those is bypassed or the vendor CLI changes behaviour.
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
      spawn() { return streamingChild(streamOpts) },
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
  const adapter = new AntigravityCliAdapter(ctx, config)
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
  const adapter = new AntigravityCliAdapter(ctx, config)
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
  const adapter = new AntigravityCliAdapter(ctx, config)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(
    chunks.some((chunk: any) => chunk.type === 'finish' && chunk.reason?.kind === 'stop'),
    'the turn must complete normally when no blocked native tool was invoked',
  )
})

test('a turn with no tool activity at all does not raise ANTIGRAVITY_NATIVE_TOOL', async () => {
  const ctx = turnCtx({ lines: [successResultLine()] })
  const adapter = new AntigravityCliAdapter(ctx, config)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(chunks.some((chunk: any) => chunk.type === 'finish' && chunk.reason?.kind === 'stop'))
})
