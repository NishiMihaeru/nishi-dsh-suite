import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { GrokCliAdapter, GROK_PRIMARY_PROVIDER } from '../src/grok-primary.ts'

const config = {
  executable: 'grok',
  env: {},
  modelCacheMs: 0,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 50,
  stderrMaxBytes: 4_096,
  contextWindowTokens: 200_000,
  vendorTurnCap: 4,
}

function decision(turn: string) {
  return { kind: 'message', text: 'ok', turn, tool_calls: [] }
}

function turnChild(stdoutBody: string) {
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => {
    stdout.write(stdoutBody)
    stdout.end()
    done.resolve({ exitCode: 0, signal: null })
  })
  return {
    pid: 9101,
    stdin: undefined,
    stdout,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdoutBody } } },
      stderr: { readFrom() { return { text: '' } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { return true },
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<{ text: string }> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return { text }
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: GROK_PRIMARY_PROVIDER,
    model: 'grok-4.6',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }] })],
    sessionId: 'sess-1' as any,
    ...overrides,
  } as GenerateOptions
}

const twentyNineTools = Array.from({ length: 29 }, (_, i) => ({
  name: `tool_${i}`,
  description: 'd',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
}))

test('a turn writes the envelope to --prompt-file and keeps argv slots small', async () => {
  const spawns: { argv: string[]; envelope: any; schema: any }[] = []
  const ctx = {
    subprocess: {
      async resolveExecutable(name: string) { return name },
      spawn(spec: { argv: readonly string[] }) {
        const argv = [...spec.argv]
        const promptFile = argv[argv.indexOf('--prompt-file') + 1]
        const file = JSON.parse(readFileSync(promptFile, 'utf8'))
        assert.equal(file.type, 'acp')
        const envelope = JSON.parse(file.content[0].text)
        const schema = JSON.parse(argv[argv.indexOf('--json-schema') + 1])
        spawns.push({ argv, envelope, schema })
        return turnChild(JSON.stringify({
          text: '',
          stopReason: 'end_turn',
          sessionId: envelope.turn,
          structuredOutput: decision(envelope.turn),
          usage: { input_tokens: 10, output_tokens: 2 },
        }))
      },
    },
  } as any

  const adapter = new GrokCliAdapter(ctx, config)
  try {
    const result = await collect(adapter.stream(request({
      system: 'BE BRIEF',
      tools: twentyNineTools,
    })))
    assert.equal(result.text, 'ok')
    assert.equal(spawns.length, 1)
    const { argv, envelope, schema } = spawns[0]
    assert.ok(argv.includes('--prompt-file'))
    assert.ok(!argv.includes('--prompt-json'))
    assert.equal(envelope.kind, 'full')
    assert.equal(envelope.system, 'BE BRIEF')
    assert.equal(schema.properties.tool_calls.items.anyOf, undefined)
    assert.equal(schema.properties.tool_calls.items.properties.name.enum.length, 29)
    const largest = argv.reduce((max, slot) => Math.max(max, slot.length), 0)
    assert.ok(largest < 16_384, `largest argv slot was ${largest} bytes`)
  } finally {
    await adapter.dispose()
  }
})

test('spawn E2BIG becomes a named adapter failure, not a raw OS crash', async () => {
  const error = Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' })
  const ctx = {
    subprocess: {
      async resolveExecutable(name: string) { return name },
      spawn() { throw error },
    },
  } as any
  const adapter = new GrokCliAdapter(ctx, config)
  try {
    await assert.rejects(
      () => collect(adapter.stream(request())),
      (err: unknown) => err instanceof LlmError
        && err.code === 'GROK_CLI'
        && /too long/.test(err.message),
    )
  } finally {
    await adapter.dispose()
  }
})
