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
 * Live acceptance for the `mcp-bridge` transport.
 *
 * Everything unit tests can decide about this transport is already decided in
 * `test/mcp-bridge.test.ts` and `test/mcp-transport.test.ts`, against a fake
 * vendor. Three things only the real vendor can settle, and each has already
 * been wrong once when reasoned about instead of run:
 *
 *  1. that `agy` injects DSH's catalog into the MODEL's toolset from a bridge
 *     server it launched itself -- a workspace-scoped plugin completes the MCP
 *     handshake and never injects anything, which is how this design was
 *     nearly abandoned;
 *  2. that a tool call blocked while DSH executes keeps the vendor turn open,
 *     and the result reaches the model INSIDE that turn. The assertion is on
 *     the content of the answer, never on the exit code: a turn that survives
 *     while the model reads nothing is exactly the failure that produces an
 *     unbounded tool loop;
 *  3. that the whole loop happens in ONE vendor child and ONE vendor turn,
 *     which is what distinguishes this transport from the schema one.
 *
 * Prerequisites, and this suite asserts them rather than failing obscurely:
 * the bridge server must be registered with the vendor, and granted. Once per
 * machine:
 *
 *   agy mcp add dshtools node <repo>/packages/antigravity/lib/mcp-bridge-server.js
 *   # then add "mcp(dshtools/*)" to userSettings.globalPermissionGrants.allow
 *   # in ~/.gemini/config/config.json
 *
 * Run with: `pnpm test:live:mcp-bridge`. It spends real vendor quota: one
 * conversation of two steps on the cheapest model.
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

/**
 * Counts turn spawns only. `models` and `mcp list` are the adapter's own
 * housekeeping calls and would otherwise hide the fact under test: that one
 * child serves the whole tool loop.
 */
function createTestContext(turnSpawns: { count: number }) {
  const ctx = new Context()
  new LlmRuntime(ctx)

  const subprocess = {
    async resolveExecutable(name: string) {
      if (name === 'cmd.exe') return process.env.COMSPEC || 'cmd.exe'
      return findOnPath(name) ?? name
    },
    spawn(spec: any) {
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
  // Generous: on this transport the timeout scopes the whole vendor turn,
  // which spans both DSH steps and the tool execution between them.
  turnTimeoutMs: 240_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  sessionIdleMs: 600_000,
  transport: 'mcp-bridge' as const,
} as const

const MODEL = 'gemini-3.7-flash-low'

/**
 * A value the model cannot produce from the prompt, the tool name or its own
 * knowledge. If it appears in the answer, the tool result reached the model.
 */
const SECRET = 'ORBIT-74193-KESTREL'

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

test('ANTIGRAVITY MCP BRIDGE: the vendor calls a DSH tool natively and reads its real result in the same turn', async () => {
  const turnSpawns = { count: 0 }
  const ctx = createTestContext(turnSpawns)
  const adapter = createAntigravityPrimaryAdapter(ctx as any, testConfig)
  const sessionId = 'live-mcp-bridge' as any

  try {
    const tools = [{
      name: 'read_orbit_manifest',
      description: 'Read the orbit manifest and return its clearance code.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { manifest: { type: 'string', description: 'Manifest name.' } },
        required: ['manifest'],
      },
    }]
    const system = 'You answer using the DSH tools you are given. Never guess a value a tool can tell you.'
    const first = createUserMessage({
      content: [{
        type: 'text',
        text: 'Read the orbit manifest named "primary" with the read_orbit_manifest tool, then tell me its clearance code exactly as the tool reports it.',
      }],
    })

    // Step one: the model should ask for the tool. On this transport the
    // vendor turn stays OPEN while we do -- nothing here closes it.
    const step1 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      sessionId,
      system,
      messages: [first],
      tools,
    } as any))

    assert.equal(
      step1.toolCalls.length, 1,
      `expected exactly one DSH tool call from the bridge, got ${step1.toolCalls.length}. text=${JSON.stringify(step1.text)}`,
    )
    assert.equal(step1.toolCalls[0]!.name, 'read_orbit_manifest')
    assert.deepEqual(step1.finishReason, { kind: 'tool-calls' })
    // The vendor has not finished counting the turn, so this step reports none.
    assert.equal(step1.usage, undefined, 'a mid-turn step must not report usage')

    // DSH executes the tool. This is the whole point of the transport: the
    // vendor asked, but the loop and the permissions stayed on this side.
    const call = step1.toolCalls[0]!
    const step2 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      sessionId,
      system,
      messages: [
        first,
        createAssistantMessage({
          content: [{
            type: 'tool-call',
            id: ToolCallId(call.id),
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          }],
          source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: MODEL },
        }),
        createToolResultMessage({
          callId: ToolCallId(call.id),
          content: [{ type: 'text', text: `clearance code: ${SECRET}` }],
        }),
      ],
      tools,
    } as any))

    assert.ok(
      step2.text.includes(SECRET),
      `the model did not read the tool result. A surviving turn is not enough. answer=${JSON.stringify(step2.text)}`,
    )
    assert.deepEqual(step2.finishReason, { kind: 'stop' })
    assert.ok(step2.usage, 'the finished turn must report usage')

    // One child, one vendor turn, for the whole loop. Two spawns would mean
    // the transport degenerated into the schema transport's shape.
    assert.equal(
      turnSpawns.count, 1,
      `the tool loop must happen inside one vendor child, saw ${turnSpawns.count} turn spawns`,
    )
  } finally {
    await adapter.dispose()
  }
})
