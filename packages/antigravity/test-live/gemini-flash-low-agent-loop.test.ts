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
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import {
  ANTIGRAVITY_PRIMARY_PROVIDER,
  createAntigravityPrimaryAdapter,
} from '../src/antigravity-primary.js'
import { noopQuotaHarvestCache } from '../src/quota-harvest-cache.js'

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
      const found = findOnPath(name)
      if (found) return found
      return name
    },
    spawn(spec: any) {
      const [cmd, ...args] = spec.argv
      const child = spawn(cmd, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', spec.stdio.stdout === 'pipe' ? 'pipe' : 'pipe', 'pipe'],
      })

      let collectedStdout = ''
      let collectedStderr = ''
      if (child.stdout) {
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => { collectedStdout += chunk })
      }
      if (child.stderr) {
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => { collectedStderr += chunk })
      }

      const done = new Promise<any>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode: any, signal: any) => resolve({ exitCode, signal }))
      })

      if (spec.signal) {
        spec.signal.addEventListener('abort', () => { child.kill() }, { once: true })
      }

      return {
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
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 30_000,
  turnTimeoutMs: 120_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  sessionIdleMs: 600_000,
} as const

async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<{
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: any }>
  finishReason: any
}> {
  let text = ''
  const toolCalls: Array<{ id: string; name: string; arguments: any }> = []
  let finishReason: any
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      let parsedArgs: any
      try {
        parsedArgs = typeof chunk.block.arguments === 'string' ? JSON.parse(chunk.block.arguments) : chunk.block.arguments
      } catch {
        parsedArgs = chunk.block.arguments
      }
      toolCalls.push({ id: String(chunk.block.id), name: chunk.block.name, arguments: parsedArgs })
    } else if (chunk.type === 'finish') {
      finishReason = chunk.reason
    }
  }
  return { text: text.trim(), toolCalls, finishReason }
}

const MODEL = 'gemini-3.8-flash'
const EFFORT = 'low'

test('GEMINI-3.8-FLASH-LOW: 1. Tool Call Schema Compliance (types, enums, required fields)', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig, noopQuotaHarvestCache())
  const sessionId = `test-gemini-schema-${Date.now()}`

  const tools = [{
    name: 'invoice_calculator',
    description: 'Calculate invoice amounts with tax',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Base amount' },
        tax_pct: { type: 'number', description: 'Tax percentage' },
        currency: { type: 'string', description: 'Currency code' },
        apply_discount: { type: 'boolean', description: 'Apply promotional discount' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags list' },
      },
      required: ['amount', 'tax_pct', 'currency', 'apply_discount', 'tags'],
      additionalProperties: false,
    },
  }]

  try {
    const result = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [
        createUserMessage({
          content: [{
            type: 'text',
            text: 'Call invoice_calculator with amount 150.75, tax_pct 0.15, currency "EUR", apply_discount true, and tags ["q3", "promo"]. Do not answer with prose first, execute the tool immediately.',
          }],
        }),
      ],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(result.finishReason?.kind, 'tool-calls', `Expected tool-calls, got: ${result.finishReason?.kind}`)
    assert.ok(result.toolCalls.length >= 1, `Expected at least 1 tool call, got: ${result.toolCalls.length}`)
    const call = result.toolCalls[0]
    assert.equal(call.name, 'invoice_calculator')
    assert.equal(typeof call.arguments.amount, 'number')
    assert.equal(call.arguments.amount, 150.75)
    assert.equal(typeof call.arguments.tax_pct, 'number')
    assert.equal(call.arguments.tax_pct, 0.15)
    assert.equal(call.arguments.currency, 'EUR')
    assert.equal(call.arguments.apply_discount, true)
    assert.deepEqual(call.arguments.tags, ['q3', 'promo'])
    console.log('  -> Gemini Flash Low correctly generated tool call with valid schema and types!')
  } finally {
    await adapter.dispose()
  }
})

test('GEMINI-3.8-FLASH-LOW: 2. Agent Loop Multi-Turn (Tool Result -> Answer & Clean Stop)', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig, noopQuotaHarvestCache())
  const sessionId = `test-gemini-loop-${Date.now()}`

  const tools = [{
    name: 'fetch_user_profile',
    description: 'Fetch profile of a user by username',
    parameters: {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    },
  }]

  try {
    const userPrompt = 'Check the profile for user "dev_expert" using fetch_user_profile and summarize their role and clearance.'
    const turn1 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [createUserMessage({ content: [{ type: 'text', text: userPrompt }] })],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn1.finishReason?.kind, 'tool-calls')
    const call = turn1.toolCalls[0]
    assert.equal(call.name, 'fetch_user_profile')
    assert.equal(call.arguments.username, 'dev_expert')

    // Turn 2
    const turn2 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: userPrompt }] }),
        createAssistantMessage({
          content: [{ type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: MODEL },
        }),
        createToolResultMessage({
          callId: ToolCallId(call.id),
          content: [{ type: 'text', text: JSON.stringify({ role: 'Lead Architect', clearance: 'TOP_SECRET_LEVEL_4', badges: ['SecurityChampion'] }) }],
        }),
      ],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn2.finishReason?.kind, 'stop', `Expected stop, got: ${turn2.finishReason?.kind}`)
    assert.equal(turn2.toolCalls.length, 0, `Model must not make additional tool calls, got: ${turn2.toolCalls.length}`)
    assert.ok(turn2.text.includes('Lead Architect'), `Expected text to mention Lead Architect, got: ${turn2.text}`)
    assert.ok(turn2.text.includes('TOP_SECRET_LEVEL_4') || turn2.text.includes('Level 4') || turn2.text.includes('level 4'), `Expected clearance in response, got: ${turn2.text}`)
    console.log('  -> Gemini Flash Low successfully continued loop, synthesized tool result, and stopped cleanly!')
  } finally {
    await adapter.dispose()
  }
})

test('GEMINI-3.8-FLASH-LOW: 3. Anti-Looping: Terminate Cleanly on Completion (Zero Repetition)', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig, noopQuotaHarvestCache())
  const sessionId = `test-gemini-antiloop-${Date.now()}`

  const tools = [{
    name: 'poll_job_status',
    description: 'Check status of background job',
    parameters: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  }]

  try {
    const prompt = 'Check status for job "job-881". If the status is COMPLETED, stop immediately and confirm "JOB_SUCCESSFULLY_COMPLETED". Do not call poll_job_status again.'
    const turn1 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }] })],
      signal: AbortSignal.timeout(60_000),
    }))
    assert.equal(turn1.finishReason?.kind, 'tool-calls')
    const call = turn1.toolCalls[0]

    // Turn 2
    const turn2 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: prompt }] }),
        createAssistantMessage({
          content: [{ type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: MODEL },
        }),
        createToolResultMessage({
          callId: ToolCallId(call.id),
          content: [{ type: 'text', text: JSON.stringify({ status: 'COMPLETED', exitCode: 0, output: 'Done 100%' }) }],
        }),
      ],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn2.finishReason?.kind, 'stop')
    assert.equal(turn2.toolCalls.length, 0, 'No loop! Zero repeated tool calls.')
    assert.ok(turn2.text.includes('JOB_SUCCESSFULLY_COMPLETED') || turn2.text.toLowerCase().includes('completed'))
    console.log('  -> Gemini Flash Low did not loop: cleanly stopped on job completion!')
  } finally {
    await adapter.dispose()
  }
})

test('GEMINI-3.8-FLASH-LOW: 4. Anti-Looping: Error Handling (No Blind Retry Loop)', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig, noopQuotaHarvestCache())
  const sessionId = `test-gemini-errorloop-${Date.now()}`

  const tools = [{
    name: 'delete_resource',
    description: 'Delete a protected resource',
    parameters: {
      type: 'object',
      properties: { resource_id: { type: 'string' } },
      required: ['resource_id'],
    },
  }]

  try {
    const prompt = 'Delete resource "root_cluster". If an error is returned, stop and explain the error.'
    const turn1 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }] })],
      signal: AbortSignal.timeout(60_000),
    }))
    assert.equal(turn1.finishReason?.kind, 'tool-calls')
    const call = turn1.toolCalls[0]

    // Turn 2
    const turn2 = await collectStream(adapter.stream({
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: MODEL,
      reasoningEffort: EFFORT,
      sessionId: sessionId as any,
      tools,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: prompt }] }),
        createAssistantMessage({
          content: [{ type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: MODEL },
        }),
        createToolResultMessage({
          callId: ToolCallId(call.id),
          content: [{ type: 'text', text: JSON.stringify({ error: 'FORBIDDEN_OPERATION', message: 'Root cluster cannot be deleted by design' }) }],
        }),
      ],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn2.finishReason?.kind, 'stop')
    assert.equal(turn2.toolCalls.length, 0, 'No loop! Model did not blindly re-issue failing delete_resource')
    assert.ok(
      turn2.text.includes('FORBIDDEN_OPERATION') ||
      turn2.text.toLowerCase().includes('cannot be deleted') ||
      turn2.text.toLowerCase().includes('forbidden') ||
      turn2.text.toLowerCase().includes('error'),
      `Model should explain error: ${turn2.text}`
    )
    console.log('  -> Gemini Flash Low handled tool error gracefully without retrying in a loop!')
  } finally {
    await adapter.dispose()
  }
})
