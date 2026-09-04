import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { GrokCliAdapter, GROK_PRIMARY_PROVIDER } from '../src/grok-primary.js'
import { headlessTurnArgv, VENDOR_META_TOOLS } from '../src/grok-vendor.js'

/**
 * The live suite for the `grok-cli` route, against the real vendor binary.
 *
 * Four things are only ever true or false against the real `grok`, and no
 * scripted child can decide any of them:
 *
 *  1. that the ACP handshake really publishes a model catalog with a context
 *     window and an effort list, at no token cost;
 *  2. that the shipped argv really reaches an empty vendor toolset -- the
 *     assertion is on `system`/`init.tools`, because the safe-looking
 *     `--tools ""` spelling fails OPEN and silently;
 *  3. that a model on the far side answers under the forced schema, echoing
 *     the step's own stamp; and
 *  4. that a second step delivered by `--resume` is SEEN -- the assertion is
 *     on a value the model could only have read from the tool result, never
 *     on the exit code -- and that the vendor's prefix cache engaged across
 *     the two processes, which is the whole reason this route holds no live
 *     child. The catalog on that exchange is 29 tools, not one: a real DSH
 *     session ended `end_turn` with no structured decision against a 29-way
 *     `anyOf` schema, then died `E2BIG` on the rebuild. This is that shape
 *     on the flat schema and `--prompt-file` path.
 *
 * Run with `pnpm test:live:primary`. It spends real vendor quota: four turns
 * on `grok-4.5` at the lowest effort. Do not point `DSH_LIVE_GROK_MODEL` at
 * `grok-4.6` for this suite.
 */

const LIVE_MODEL = process.env.DSH_LIVE_GROK_MODEL ?? 'grok-4.5'
const LIVE_EFFORT = process.env.DSH_LIVE_GROK_EFFORT ?? 'low'

if (LIVE_MODEL === 'grok-4.6') {
  throw new Error(
    'test-live/primary.test.ts spends quota; grok-4.6 is not the model for this suite. '
    + 'Unset DSH_LIVE_GROK_MODEL or set it to grok-4.5.',
  )
}

function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || ''
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':')
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function createTestContext() {
  const ctx = new Context()
  new LlmRuntime(ctx)

  const subprocess = {
    async resolveExecutable(name: string) {
      if (name === 'cmd.exe') return process.env.COMSPEC || 'cmd.exe'
      return findOnPath(name) ?? name
    },
    spawn(spec: any) {
      const [cmd, ...args] = spec.argv
      const child = spawn(cmd, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: [
          spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore',
          'pipe',
          'pipe',
        ],
      })

      let collectedStdout = ''
      let collectedStderr = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => { collectedStdout += chunk })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => { collectedStderr += chunk })

      const done = new Promise<any>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode: any, signal: any) => resolve({ exitCode, signal }))
      })

      if (spec.signal) {
        spec.signal.addEventListener('abort', () => { child.kill() }, { once: true })
      }

      return {
        pid: child.pid ?? -1,
        stdin: child.stdin,
        stdout: spec.stdio.stdout === 'pipe' ? child.stdout : null,
        collected: {
          stdout: { readFrom(_offset: number) { return { text: collectedStdout } } },
          stderr: { readFrom(_offset: number) { return { text: collectedStderr } } },
        },
        done,
        terminate() { child.kill() },
        async waitForExit() { await done.catch(() => {}); return true },
      }
    },
  }

  ;(ctx as any).subprocess = subprocess
  return ctx
}

const testConfig = {
  executable: 'grok',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 60_000,
  turnTimeoutMs: 300_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  vendorTurnCap: 4,
} as const

interface Collected {
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: any }>
  finishReason: any
  usage: any
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<Collected> {
  let text = ''
  const toolCalls: Collected['toolCalls'] = []
  let finishReason: any
  let usage: any
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      toolCalls.push({
        id: String(chunk.block.id),
        name: chunk.block.name,
        arguments: JSON.parse(chunk.block.arguments),
      })
    } else if (chunk.type === 'finish') finishReason = chunk.reason
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  return { text, toolCalls, finishReason, usage }
}

function request(overrides: Partial<GenerateOptions>): GenerateOptions {
  return {
    provider: GROK_PRIMARY_PROVIDER,
    model: LIVE_MODEL,
    reasoningEffort: LIVE_EFFORT as any,
    messages: [],
    ...overrides,
  } as GenerateOptions
}

test('GROK LIVE: 1. the ACP handshake publishes a catalog, a window and efforts, spending no tokens', async () => {
  const adapter = new GrokCliAdapter(createTestContext(), testConfig)
  try {
    const models = await adapter.listModels(GROK_PRIMARY_PROVIDER)
    assert.ok(models.length > 0, 'the handshake must report at least one routable model')
    assert.ok(
      models.some(model => model.id === LIVE_MODEL),
      `the account must be able to route ${LIVE_MODEL}`,
    )

    const resolved = await adapter.resolveModel(GROK_PRIMARY_PROVIDER, LIVE_MODEL)
    assert.ok(
      (resolved.context?.contextWindow ?? 0) > testConfig.contextWindowTokens,
      'the vendor-published window must be read, not the conservative fallback',
    )
    assert.ok(
      (resolved.reasoning?.efforts.length ?? 0) > 1,
      'the handshake must publish more than one reasoning effort',
    )
    assert.ok(resolved.reasoning?.defaultEffort !== undefined, 'one effort must be marked default')
  } finally {
    await adapter.dispose()
  }
})

test('GROK LIVE: 2. the shipped argv leaves the model no vendor tool but the MCP meta-tools', { timeout: 300_000 }, async () => {
  // The shipped argv verbatim, with only the output format swapped: the
  // `system`/`init` line that reports the resolved toolset exists in the
  // Messages stream and not in the `json` envelope this route reads. Anything
  // else about the invocation is what the product sends.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-live-'))
  const promptFile = join(dir, 'prompt.json')
  await writeFile(promptFile, JSON.stringify({
    type: 'acp',
    content: [{ type: 'text', text: 'Reply with exactly: OK' }],
  }), 'utf8')
  const argv = headlessTurnArgv({
    promptFile,
    schemaJson: JSON.stringify({
      type: 'object',
      additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['message'] }, text: { type: 'string' }, turn: { type: 'string' } },
      required: ['kind', 'text', 'turn'],
    }),
    model: LIVE_MODEL,
    effort: LIVE_EFFORT,
    sessionId: crypto.randomUUID(),
    resume: false,
    turnCap: 4,
  })
  const format = argv.indexOf('--output-format')
  argv[format + 1] = 'streaming-messages-json'

  const executable = findOnPath('grok') ?? 'grok'
  const child = spawn(executable, argv, { windowsHide: true })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  const exitCode: number | null = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  assert.equal(exitCode, 0, 'the isolation probe turn must succeed')

  const init = stdout
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line))
    .find(line => line.type === 'system' && line.subtype === 'init')
  assert.ok(init, 'the Messages stream must open with a system/init line')

  const tools: string[] = init.tools ?? []
  const unexpected = tools.filter(name => !VENDOR_META_TOOLS.has(name))
  assert.deepEqual(
    unexpected,
    [],
    `the vendor must hold no tool of its own; got ${JSON.stringify(tools)}`,
  )
})

test('GROK LIVE: 3. a turn answers under the forced schema', { timeout: 300_000 }, async () => {
  const adapter = new GrokCliAdapter(createTestContext(), testConfig)
  try {
    const result = await collect(adapter.stream(request({
      system: 'Answer exactly as asked, with no extra words.',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply with exactly: PINEAPPLE' }] })],
      sessionId: 'live-plain' as any,
    })))
    assert.match(result.text, /PINEAPPLE/i)
    assert.deepEqual(result.finishReason, { kind: 'stop' })
    assert.ok((result.usage?.inputTokens ?? 0) > 0, 'the turn must report its own spend')
  } finally {
    await adapter.dispose()
  }
})

/**
 * A 29-name catalog, the size that broke structured output in production.
 *
 * One real tool, the rest decoys with DSH-like names. The schema pins every
 * name and types none of the arguments. If that shape is unenforceable the
 * adapter throws `GROK_PROTOCOL` before any of the assertions below run.
 */
function fatCatalog() {
  const decoys = [
    'read', 'write', 'edit', 'bash', 'grep', 'glob', 'web_search', 'web_fetch',
    'memory_read', 'memory_write', 'memory_edit', 'todo', 'task', 'plan',
    'list_dir', 'search_replace', 'read_file', 'write_file', 'run_terminal_command',
    'spawn_subagent', 'ask_user', 'browser', 'mcp_call', 'image_gen',
    'notebook_edit', 'compact', 'switch_mode', 'enter_plan_mode',
  ]
  const lookup = {
    name: 'lookup_reactor_code',
    description: 'Return the reactor code for a named reactor. Use this for reactor codes; do not guess.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { reactor: { type: 'string' } },
      required: ['reactor'],
    },
  }
  return [
    lookup,
    ...decoys.map(name => ({
      name,
      description: `Decoy tool ${name}. Do not call this.`,
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    })),
  ]
}

test('GROK LIVE: 4. a 29-tool catalog still yields a structured call, resume sees the result, cache engages', { timeout: 600_000 }, async () => {
  const adapter = new GrokCliAdapter(createTestContext(), testConfig)
  const sessionId = 'live-tool-loop' as any
  const tools = fatCatalog()
  assert.equal(tools.length, 29)

  try {
    const first = await collect(adapter.stream(request({
      system: 'Use the provided tools when a question needs them.',
      tools,
      sessionId,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'What is the reactor code for reactor "NORTH"? Use the tool.' }],
      })],
    })))
    assert.equal(first.toolCalls.length, 1, 'the model must call the declared tool')
    assert.equal(first.toolCalls[0].name, 'lookup_reactor_code')
    assert.deepEqual(first.finishReason, { kind: 'tool-calls' })

    const callId = ToolCallId(first.toolCalls[0].id)
    const second = await collect(adapter.stream(request({
      system: 'Use the provided tools when a question needs them.',
      tools,
      sessionId,
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'What is the reactor code for reactor "NORTH"? Use the tool.' }],
        }),
        createAssistantMessage({
          content: [{
            type: 'tool-call',
            id: callId,
            name: 'lookup_reactor_code',
            arguments: JSON.stringify(first.toolCalls[0].arguments),
          }],
          source: { provider: GROK_PRIMARY_PROVIDER, model: LIVE_MODEL },
        }),
        createToolResultMessage({
          callId,
          content: [{ type: 'text', text: 'AURORA-7731' }],
          isError: false,
        }),
      ],
    })))

    assert.match(
      second.text,
      /AURORA-7731/,
      'the model must answer with a value it could only have read from the tool result',
    )
    assert.ok(
      (second.usage?.cacheReadTokens ?? 0) > 0,
      'resuming in a NEW process must still hit the vendor prefix cache -- '
      + 'that is the whole reason this route holds no live child',
    )
  } finally {
    await adapter.dispose()
  }
})
