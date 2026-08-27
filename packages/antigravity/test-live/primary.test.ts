import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  LlmError,
  createUserMessage,
  createAssistantMessage,
  createToolResultMessage,
  type ContentBlock,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  ANTIGRAVITY_PRIMARY_PROVIDER,
  AntigravityCliAdapter,
  createAntigravityPrimaryAdapter,
} from '../src/antigravity-primary.js'

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

function userText(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }] })
}

function assistantText(text: string, model = 'gemini-3.7-flash-medium') {
  return createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model },
  })
}

function assistantToolCall(callId: string, name: string, args: Record<string, unknown>, model = 'gemini-3.7-flash-medium') {
  return createAssistantMessage({
    content: [{ type: 'tool-call', id: CallId(callId), name, arguments: JSON.stringify(args) }],
    source: { provider: ANTIGRAVITY_PRIMARY_PROVIDER, model },
  })
}

function toolResult(callId: string, text: string) {
  return createToolResultMessage({ callId: CallId(callId), content: [{ type: 'text', text }] })
}

function createTestContext() {
  const ctx = new Context()
  new LlmRuntime(ctx)

  const subprocess = {
    async resolveExecutable(name: string, _env?: Record<string, string>, _signal?: AbortSignal) {
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
        async waitForExit(_signal?: AbortSignal) { await done.catch(() => {}); return true },
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
} as const

async function collectStreamText(stream: AsyncIterable<StreamChunk>): Promise<{
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: any }>
  finishReason: any
  usage: any
}> {
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

test('ANTIGRAVITY PRODUCTION: 1. Model Catalog Discovery through DSH LLM Service', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    const models = await adapter.listModels(ANTIGRAVITY_PRIMARY_PROVIDER)
    assert.ok(models.length > 0, 'Must discover at least one model')
    const ids = models.map(m => m.id)
    assert.ok(ids.includes('gemini-3.7-flash-medium') || ids.some(id => id.startsWith('gemini-')), 'Must include Gemini model')
    const resolved = await adapter.resolveModel(ANTIGRAVITY_PRIMARY_PROVIDER, 'gemini-3.7-flash-medium')
    assert.equal(resolved.id, 'gemini-3.7-flash-medium')
    assert.equal(resolved.provider, ANTIGRAVITY_PRIMARY_PROVIDER)
    assert.deepEqual(resolved.inputModalities, ['text'])
  } finally { await adapter.dispose() }
})

test('ANTIGRAVITY PRODUCTION: 2. Real Turn through DSH Adapter', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    const options: GenerateOptions = {
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: 'gemini-3.7-flash-medium',
      reasoningEffort: 'medium',
      messages: [userText('Reply exactly with the text: REAL_TURN_OK')],
    }
    const result = await collectStreamText(adapter.stream(options))
    assert.ok(result.text.includes('REAL_TURN_OK'), `Expected text to contain REAL_TURN_OK, got: ${result.text}`)
    assert.equal(result.finishReason?.kind, 'stop')
    assert.ok(result.usage?.inputTokens > 0)
    assert.ok(result.usage?.outputTokens > 0)
  } finally { await adapter.dispose() }
})

test('ANTIGRAVITY PRODUCTION: 3. DSH Tool Loop', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    const tools = [{
      name: 'lookup_user_status',
      description: 'Look up the status of a user',
      parameters: { type: 'object', additionalProperties: false, properties: { username: { type: 'string' } }, required: ['username'] },
    }]
    const turn1Options: GenerateOptions = {
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: 'gemini-3.7-flash-medium',
      reasoningEffort: 'medium',
      tools,
      messages: [userText('Use the lookup_user_status tool to check the status of user "alice".')],
    }
    const turn1Result = await collectStreamText(adapter.stream(turn1Options))
    assert.equal(turn1Result.finishReason?.kind, 'tool-calls')
    assert.equal(turn1Result.toolCalls.length, 1)
    const call = turn1Result.toolCalls[0]
    assert.equal(call.name, 'lookup_user_status')
    assert.equal(call.arguments.username, 'alice')

    const turn2Options: GenerateOptions = {
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: 'gemini-3.7-flash-medium',
      reasoningEffort: 'medium',
      tools,
      messages: [
        userText('Use the lookup_user_status tool to check the status of user "alice".'),
        assistantToolCall(call.id, call.name, call.arguments),
        toolResult(call.id, JSON.stringify({ status: 'ACTIVE_PREMIUM', tier: 3 })),
      ],
    }
    const turn2Result = await collectStreamText(adapter.stream(turn2Options))
    assert.equal(turn2Result.finishReason?.kind, 'stop')
    assert.ok(turn2Result.text.includes('ACTIVE_PREMIUM') || turn2Result.text.toLowerCase().includes('active') || turn2Result.text.includes('Premium') || turn2Result.text.includes('3'))
  } finally { await adapter.dispose() }
})

test('ANTIGRAVITY PRODUCTION: 4. Shared Project Memory', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    const options: GenerateOptions = {
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: 'gemini-3.7-flash-medium',
      reasoningEffort: 'medium',
      system: '# Project Memory\n- Project Codename: PROJECT_PHOENIX_ALPHA\n- Database Port: 54321\n- Authentication: DSH managed',
      messages: [userText('What is the project codename specified in project memory? Reply with only the codename.')],
    }
    const result = await collectStreamText(adapter.stream(options))
    assert.ok(result.text.includes('PROJECT_PHOENIX_ALPHA'))
  } finally { await adapter.dispose() }
})

test('ANTIGRAVITY PRODUCTION: 5. Session Reopen from DSH Durable History', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    const sessionNonce = `NONCE-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const reopenedOptions: GenerateOptions = {
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: 'gemini-3.7-flash-medium',
      reasoningEffort: 'medium',
      messages: [
        userText(`In an earlier session turn, the user saved the secret token: ${sessionNonce}`),
        assistantText(`Understood. The secret token ${sessionNonce} is recorded.`),
        userText('Please repeat the exact secret token from the earlier turn.'),
      ],
    }
    const result = await collectStreamText(adapter.stream(reopenedOptions))
    assert.ok(result.text.includes(sessionNonce))
  } finally { await adapter.dispose() }
})

test('ANTIGRAVITY PRODUCTION: 6. Model Switch across DSH Primary Models', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    const models = await adapter.listModels(ANTIGRAVITY_PRIMARY_PROVIDER)
    const hasClaude = models.some(m => m.id === 'claude-sonnet-4-6')
    const switchNonce = `SWITCH-${Date.now()}`
    const geminiOptions: GenerateOptions = {
      provider: ANTIGRAVITY_PRIMARY_PROVIDER,
      model: 'gemini-3.7-flash-medium',
      reasoningEffort: 'medium',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: `DSH session started on deepseek-chat. Variable alpha is ${switchNonce}.` }], source: { kind: 'user' } }),
        createAssistantMessage({ content: [{ type: 'text', text: `Acknowledged alpha is ${switchNonce}.` }], source: { provider: 'deepseek', model: 'deepseek-chat' } }),
        userText('We switched models to Gemini. What was variable alpha? Reply with only the value.'),
      ],
    }
    const geminiResult = await collectStreamText(adapter.stream(geminiOptions))
    assert.ok(geminiResult.text.includes(switchNonce))

    if (hasClaude) {
      const claudeOptions: GenerateOptions = {
        provider: ANTIGRAVITY_PRIMARY_PROVIDER,
        model: 'claude-sonnet-4-6',
        messages: [
          assistantText(`Variable alpha is ${switchNonce}.`),
          userText('We switched models to Claude. What was variable alpha? Reply with only the value.'),
        ],
      }
      const claudeResult = await collectStreamText(adapter.stream(claudeOptions))
      assert.ok(claudeResult.text.includes(switchNonce))
    }
  } finally { await adapter.dispose() }
})

test('ANTIGRAVITY PRODUCTION: 7. Workspace and Native Tool Isolation', async () => {
  assert.equal(existsSync(join(process.cwd(), '.agents', 'agents', 'dsh-primary')), false)
})

test('ANTIGRAVITY PRODUCTION: 8. Failure and Unsupported Request Semantics', async () => {
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx, testConfig)
  try {
    await assert.rejects(async () => {
      for await (const _ of adapter.stream({ provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: 'gemini-3.7-flash-medium', temperature: 0.5, messages: [userText('test')] })) {}
    }, (err: any) => err instanceof LlmError && err.code === 'UNSUPPORTED')
    await assert.rejects(async () => {
      for await (const _ of adapter.stream({ provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: 'gemini-3.7-flash-medium', maxTokens: 100, messages: [userText('test')] })) {}
    }, (err: any) => err instanceof LlmError && err.code === 'UNSUPPORTED')
    await assert.rejects(async () => {
      for await (const _ of adapter.stream({ provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: 'gemini-3.7-flash-medium', stop: ['END'], messages: [userText('test')] })) {}
    }, (err: any) => err instanceof LlmError && err.code === 'UNSUPPORTED')
    await assert.rejects(async () => {
      for await (const _ of adapter.stream({
        provider: ANTIGRAVITY_PRIMARY_PROVIDER,
        model: 'gemini-3.7-flash-medium',
        messages: [createUserMessage({ content: [{ type: 'text', text: 'describe this' }, { type: 'image', mediaType: 'image/png', data: 'abcd' }] as ContentBlock[] })],
      })) {}
    }, (err: any) => err instanceof LlmError && err.code === 'UNSUPPORTED')

    const models = await adapter.listModels(ANTIGRAVITY_PRIMARY_PROVIDER)
    if (models.some(m => m.id === 'claude-sonnet-4-6')) {
      await assert.rejects(async () => {
        for await (const _ of adapter.stream({ provider: ANTIGRAVITY_PRIMARY_PROVIDER, model: 'claude-sonnet-4-6', reasoningEffort: 'medium', messages: [userText('hi')] })) {}
      }, (err: any) => err instanceof LlmError && err.code === 'UNSUPPORTED')
    }
  } finally { await adapter.dispose() }
})
