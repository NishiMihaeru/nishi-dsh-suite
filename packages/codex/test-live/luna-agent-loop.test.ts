import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test, { after } from 'node:test'
import * as codex from '../src/index.ts'
import { resolveCodexExecutable } from '../src/resolver.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

const liveChildren = new Set<{ pid: number | undefined }>()

function killTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || pid <= 0) return
  try {
    process.kill(-pid, signal)
  } catch {
    try { process.kill(pid, signal) } catch {}
  }
}

after(async () => {
  for (const child of liveChildren) killTree(child.pid, 'SIGKILL')
  liveChildren.clear()
})

function createRealSubprocess() {
  return {
    async resolveExecutable(name: string) {
      return name
    },
    spawn(spec: any) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      })
      liveChildren.add(child)
      let resolveDone: any
      let rejectDone: any
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
        resolveDone = res
        rejectDone = rej
      })
      child.on('exit', (exitCode, signal) => {
        liveChildren.delete(child)
        resolveDone({ exitCode, signal })
      })
      child.on('error', (err) => {
        rejectDone(err)
      })
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: {
          stderr: {
            readFrom() {
              return { text: '' }
            },
          },
        },
        done,
        terminate() {
          killTree(child.pid, 'SIGTERM')
          const escalation = setTimeout(() => killTree(child.pid, 'SIGKILL'), 2_000)
          escalation.unref?.()
          void done.then(() => clearTimeout(escalation), () => clearTimeout(escalation))
        },
        async waitForExit() {
          await done.catch(() => {})
          return true
        },
      }
    },
  }
}

function createLiveContext() {
  const adapters = new Map<string, any>()
  const registeredProviders = new Map<string, any>()
  const events = new Map<string, Function[]>()
  const sessions = new Map<string, any>()

  const ctx: any = {
    nishiProviders: {
      record(entry: any) {
        registeredProviders.set(entry.id, entry)
        return () => registeredProviders.delete(entry.id)
      },
      invalidate() {},
    },
    subprocess: createRealSubprocess(),
    llm: {
      adapters,
      registerAdapter(names: string[], adapter: any) {
        for (const name of names) adapters.set(name, adapter)
        return () => {
          for (const name of names) {
            if (adapters.get(name) === adapter) adapters.delete(name)
          }
        }
      },
    },
    sessions: {
      get(id: string) {
        if (!sessions.has(id)) {
          sessions.set(id, { header: { id, cwd: process.cwd() } })
        }
        return sessions.get(id)
      },
    },
    attachments: {
      async readImage() { throw new Error('No attachments in live test') },
      async saveImage() { throw new Error('No attachments in live test') },
    },
    on(event: string, fn: Function) {
      const list = events.get(event) ?? []
      list.push(fn)
      events.set(event, list)
    },
    effect(fn: () => unknown) {
      return fn()
    },
    logger: {
      warn(msg: string) {
        console.warn('WARN:', msg)
      },
    },
  }

  return { ctx, adapters, registeredProviders, sessions }
}

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
    } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      if (!text.includes(chunk.block.text)) text += chunk.block.text
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

const MODEL = 'gpt-5.6-luna'

test('GPT-5.6-LUNA: 1. Tool Call Schema Compliance (types, enums, required fields)', async () => {
  const resolved = resolveCodexExecutable()
  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  const adapter = adapters.get('codex-app-server')
  const sessionId = `test-luna-schema-${Date.now()}`
  sessions.set(sessionId, { header: { id: sessionId, cwd: process.cwd() } })

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
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: 'Call invoice_calculator with amount 150.75, tax_pct 0.15, currency "EUR", apply_discount true, and tags ["q3", "promo"]. Do not answer with prose first, execute the tool immediately.',
        }],
        source: { kind: 'user' },
      }],
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
    console.log('  -> Luna correctly generated tool call with valid schema and types!')
  } finally {
    await adapter.dispose()
  }
})

test('GPT-5.6-LUNA: 2. Agent Loop Multi-Turn (Tool Result -> Answer & Clean Stop)', async () => {
  const resolved = resolveCodexExecutable()
  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  const adapter = adapters.get('codex-app-server')
  const sessionId = `test-luna-loop-${Date.now()}`
  sessions.set(sessionId, { header: { id: sessionId, cwd: process.cwd() } })

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
    // Step 1: Model calls tool
    const turn1 = await collectStream(adapter.stream({
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Check the profile for user "dev_expert" using fetch_user_profile and summarize their role and clearance.' }],
        source: { kind: 'user' },
      }],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn1.finishReason?.kind, 'tool-calls')
    const call = turn1.toolCalls[0]
    assert.equal(call.name, 'fetch_user_profile')
    assert.equal(call.arguments.username, 'dev_expert')

    // Step 2: Ingest tool result and continue
    const turn2 = await collectStream(adapter.stream({
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Check the profile for user "dev_expert" using fetch_user_profile and summarize their role and clearance.' }],
          source: { kind: 'user' },
        },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: 'codex-app-server', model: MODEL },
        },
        {
          role: 'user',
          source: { kind: 'tool', callId: call.id },
          content: [{
            type: 'tool-result',
            toolCallId: call.id,
            content: [{ type: 'text', text: JSON.stringify({ role: 'Lead Architect', clearance: 'TOP_SECRET_LEVEL_4', badges: ['SecurityChampion'] }) }],
          }],
        },
      ],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn2.finishReason?.kind, 'stop', `Expected stop, got: ${turn2.finishReason?.kind}`)
    assert.equal(turn2.toolCalls.length, 0, `Model must not make additional tool calls, got: ${turn2.toolCalls.length}`)
    assert.ok(turn2.text.includes('Lead Architect'), `Expected text to mention Lead Architect, got: ${turn2.text}`)
    assert.ok(turn2.text.includes('TOP_SECRET_LEVEL_4') || turn2.text.includes('Level 4') || turn2.text.includes('level 4'), `Expected clearance in response, got: ${turn2.text}`)
    console.log('  -> Luna successfully continued loop, synthesized tool result, and stopped cleanly!')
  } finally {
    await adapter.dispose()
  }
})

test('GPT-5.6-LUNA: 3. Anti-Looping: Terminate Cleanly on Completion (Zero Repetition)', async () => {
  const resolved = resolveCodexExecutable()
  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  const adapter = adapters.get('codex-app-server')
  const sessionId = `test-luna-antiloop-${Date.now()}`
  sessions.set(sessionId, { header: { id: sessionId, cwd: process.cwd() } })

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
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }],
      signal: AbortSignal.timeout(60_000),
    }))
    assert.equal(turn1.finishReason?.kind, 'tool-calls')
    const call = turn1.toolCalls[0]

    // Turn 2: Job is already COMPLETED
    const turn2 = await collectStream(adapter.stream({
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [
        { role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: 'codex-app-server', model: MODEL },
        },
        {
          role: 'user',
          source: { kind: 'tool', callId: call.id },
          content: [{
            type: 'tool-result',
            toolCallId: call.id,
            content: [{ type: 'text', text: JSON.stringify({ status: 'COMPLETED', exitCode: 0, output: 'Done 100%' }) }],
          }],
        },
      ],
      signal: AbortSignal.timeout(60_000),
    }))

    assert.equal(turn2.finishReason?.kind, 'stop')
    assert.equal(turn2.toolCalls.length, 0, 'No loop! Zero repeated tool calls.')
    assert.ok(turn2.text.includes('JOB_SUCCESSFULLY_COMPLETED') || turn2.text.toLowerCase().includes('completed'))
    console.log('  -> Luna did not loop: cleanly stopped on job completion!')
  } finally {
    await adapter.dispose()
  }
})

test('GPT-5.6-LUNA: 4. Anti-Looping: Error Handling (No Blind Retry Loop)', async () => {
  const resolved = resolveCodexExecutable()
  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  const adapter = adapters.get('codex-app-server')
  const sessionId = `test-luna-errorloop-${Date.now()}`
  sessions.set(sessionId, { header: { id: sessionId, cwd: process.cwd() } })

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
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }],
      signal: AbortSignal.timeout(60_000),
    }))
    assert.equal(turn1.finishReason?.kind, 'tool-calls')
    const call = turn1.toolCalls[0]

    // Turn 2: Returns FORBIDDEN error
    const turn2 = await collectStream(adapter.stream({
      provider: 'codex-app-server',
      model: MODEL,
      sessionId,
      tools,
      messages: [
        { role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) }],
          source: { provider: 'codex-app-server', model: MODEL },
        },
        {
          role: 'user',
          source: { kind: 'tool', callId: call.id },
          content: [{
            type: 'tool-result',
            toolCallId: call.id,
            content: [{ type: 'text', text: JSON.stringify({ error: 'FORBIDDEN_OPERATION', message: 'Root cluster cannot be deleted by design' }) }],
          }],
        },
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
    console.log('  -> Luna handled tool error gracefully without retrying in a loop!')
  } finally {
    await adapter.dispose()
  }
})
