import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  ToolCallId,
  createUserMessage,
  createAssistantMessage,
  createToolResultMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  ANTIGRAVITY_PRIMARY_PROVIDER,
  createAntigravityPrimaryAdapter,
} from '../src/antigravity-primary.js'

/**
 * The live counterpart of `test/session-reuse.test.ts`, and the Antigravity
 * analogue of Codex's `test:live:tool-result-continuation`.
 *
 * Two things are only ever true or false against the real vendor, and unit
 * tests with a scripted child cannot decide either:
 *
 *  1. that `agy --input-format stream-json` really does run a second turn
 *     from a second NDJSON line in the same process, rather than treating
 *     the first line as the whole session; and
 *  2. that the model on the far side actually SEES a tool result delivered
 *     as a `delta` envelope -- not merely that the turn survives. A turn
 *     that survives while the model reads nothing is exactly the failure
 *     that produces an unbounded read/grep loop, so the assertion is on the
 *     content of the answer, never on the exit code.
 *
 * Run with: `pnpm test:live:session-continuation`. It spends real vendor
 * quota: two turns on the cheapest model.
 */

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

/** Counts the turn spawns, which is how "one process, two turns" is observed at all. */
function createTestContext(turnSpawns: { count: number }) {
  const ctx = new Context()
  new LlmRuntime(ctx)

  const subprocess = {
    async resolveExecutable(name: string) {
      if (name === 'cmd.exe') return process.env.COMSPEC || 'cmd.exe'
      return findOnPath(name) ?? name
    },
    spawn(spec: any) {
      // `models` is the catalog lookup, not a turn: counting that housekeeping
      // call as a turn child is what made this assertion read 2. `list` is
      // still excluded although nothing runs it since the MCP bridge was
      // removed, because a future housekeeping subcommand would trip this the
      // same way and the exclusion costs nothing.
      const housekeeping = spec.argv.includes('models') || spec.argv.includes('list')
      if (!housekeeping) turnSpawns.count += 1
      const [cmd, ...args] = spec.argv
      const child = spawn(cmd, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
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
      if (spec.signal) spec.signal.addEventListener('abort', () => { child.kill() }, { once: true })

      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: spec.stdio.stdout === 'pipe' ? child.stdout : null,
        collected: {
          stdout: { readFrom() { return { text: collectedStdout } } },
          stderr: { readFrom() { return { text: collectedStderr } } },
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
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 30_000,
  turnTimeoutMs: 180_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  sessionIdleMs: 600_000,
} as const

const MODEL = 'gemini-3.7-flash-low'

async function collectStream(stream: AsyncIterable<StreamChunk>) {
  let text = ''
  const toolCalls: Array<{ id: string; name: string; arguments: any }> = []
  let finishReason: any
  let usage: any
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      toolCalls.push({ id: String(chunk.block.id), name: chunk.block.name, arguments: JSON.parse(chunk.block.arguments) })
    } else if (chunk.type === 'finish') finishReason = chunk.reason
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  return { text, toolCalls, finishReason, usage }
}

test('ANTIGRAVITY PRODUCTION: one live child serves both steps, and the model reads the tool result', async () => {
  const turnSpawns = { count: 0 }
  const ctx = createTestContext(turnSpawns)
  const adapter = createAntigravityPrimaryAdapter(ctx as any, testConfig)
  const sessionId = 'live-session-continuation' as any

  try {
    const tools = [{
      name: 'lookup_user_status',
      description: 'Look up the status of a user',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { username: { type: 'string' } },
        required: ['username'],
      },
    }]
    const system = 'You answer using the DSH tools you are given.'
    const opening = createUserMessage({
      content: [{ type: 'text', text: 'Use the lookup_user_status tool to check the status of user "alice".' }],
    })

    const step1 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      sessionId,
      system,
      tools,
      messages: [opening],
    } as any))

    assert.equal(step1.finishReason?.kind, 'tool-calls')
    assert.equal(step1.toolCalls.length, 1)
    const call = step1.toolCalls[0]
    assert.equal(call.name, 'lookup_user_status')
    assert.equal(call.arguments.username, 'alice')
    assert.equal(turnSpawns.count, 1, 'the opening step spawned exactly one turn child')

    // A value the model cannot produce from the prompt: if it appears in the
    // answer, the delta envelope reached the model and it read the result.
    const secret = 'ACTIVE_PREMIUM_TIER_7'
    const step2 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      sessionId,
      system,
      tools,
      messages: [
        opening,
        createAssistantMessage({
          content: [{ type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: MODEL },
        }),
        createToolResultMessage({
          callId: ToolCallId(call.id),
          content: [{ type: 'text', text: JSON.stringify({ status: secret }) }],
        }),
      ],
    } as any))

    assert.equal(
      turnSpawns.count,
      1,
      `the second step must continue the live child, not spawn another (spawns: ${turnSpawns.count})`,
    )
    assert.equal(step2.finishReason?.kind, 'stop')
    assert.ok(
      step2.text.includes(secret) || step2.text.includes('PREMIUM') || step2.text.includes('TIER_7'),
      `the model did not read the tool result; it answered: ${JSON.stringify(step2.text)}`,
    )

    // The point of the whole change: the continuation is served from the
    // vendor's prefix cache instead of re-reading the conversation cold.
    console.log('[session-continuation] step 2 usage:', JSON.stringify(step2.usage))
  } finally {
    await adapter.dispose()
  }
})
