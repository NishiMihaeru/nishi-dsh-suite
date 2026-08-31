import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'

/**
 * The per-session live `agy` child.
 *
 * A step used to be a whole process: spawn, write the entire DSH history as
 * one JSON user message, read one result, kill. That guaranteed a fresh
 * vendor conversation every step, and a fresh conversation never hits the
 * vendor's prefix cache -- measured against real `agy 1.1.22`, a second turn
 * inside one child read 20418 of its 23496-token prefix from cache while the
 * same exchange split across two children paid full price twice.
 *
 * These tests pin the two halves that make reuse safe rather than merely
 * cheap: a live conversation is continued ONLY by a request that extends
 * exactly what it was already told, and every other case rebuilds rather
 * than sending a delta the vendor cannot place.
 */

const primaryConfig = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 100,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  sessionIdleMs: 60_000,
}

const CATALOG = ['gemini-3.7-flash-low\tGemini 3.7 Flash (Low)'].join('\n')

/** A collected child for the catalog call: emits its lines, then exits. */
function catalogChild(response: string) {
  const stdout = new PassThrough()
  const lines = [
    'Fetching available models...',
    JSON.stringify({ conversation_id: '', status: 'SUCCESS', response }),
  ]
  const text = lines.map(line => `${line}\n`).join('')
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => {
    stdout.write(text)
    stdout.end()
    done.resolve({ exitCode: 0, signal: null })
  })
  return {
    pid: 3000,
    stdin: undefined,
    stdout,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text, nextOffset: text.length, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { return true },
  }
}

/**
 * A live child that behaves like `agy --input-format stream-json`: it answers
 * one `result` per NDJSON line written to its stdin and stays up in between.
 */
function liveChild(replies: readonly unknown[]) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const received: string[] = []
  let next = 0
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  let buffer = ''
  stdin.on('data', chunk => {
    buffer += String(chunk)
    let cut = buffer.indexOf('\n')
    while (cut !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      received.push(line)
      const reply = replies[Math.min(next, replies.length - 1)]
      next += 1
      stdout.write(`${JSON.stringify({ event: 'result', result: reply })}\n`)
      cut = buffer.indexOf('\n')
    }
  })
  return {
    handle: {
      pid: 4000,
      stdin,
      stdout,
      stderr: undefined,
      collected: {
        stdout: undefined,
        stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
      },
      done: done.promise,
      terminate() { done.resolve({ exitCode: 0, signal: null }); stdout.end() },
      async waitForExit() { return true },
    },
    /** Bridge envelopes handed to the vendor, parsed, in order. */
    envelopes(): Record<string, unknown>[] {
      return received.map(line => JSON.parse(JSON.parse(line).message.content) as Record<string, unknown>)
    },
  }
}

function messageReply(text: string, usage?: Record<string, number>) {
  return {
    conversation_id: 'c1',
    status: 'SUCCESS',
    structured_output: { kind: 'message', text, tool_calls: [] },
    ...(usage === undefined ? {} : { usage }),
  }
}

function toolCallReply(id: string, name: string, args: Record<string, unknown>, usage?: Record<string, number>) {
  return {
    conversation_id: 'c1',
    status: 'SUCCESS',
    structured_output: { kind: 'tool_calls', text: '', tool_calls: [{ id, name, arguments: args }] },
    ...(usage === undefined ? {} : { usage }),
  }
}

/** A test harness whose turn spawns all return one shared live child. */
function harness(replies: readonly unknown[]) {
  const child = liveChild(replies)
  const spawns: string[][] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (spec.argv.includes('models')) return catalogChild(CATALOG)
        spawns.push([...spec.argv])
        return child.handle
      },
    },
  } as any
  return { ctx, child, spawns }
}

/**
 * Distinct live children per turn spawn, so a rebuild can be observed as a
 * second child rather than only as a second spawn.
 */
function multiHarness(repliesPerChild: readonly (readonly unknown[])[]) {
  const children: ReturnType<typeof liveChild>[] = []
  const spawns: string[][] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (spec.argv.includes('models')) return catalogChild(CATALOG)
        const child = liveChild(repliesPerChild[Math.min(children.length, repliesPerChild.length - 1)])
        children.push(child)
        spawns.push([...spec.argv])
        return child.handle
      },
    },
  } as any
  return { ctx, children, spawns }
}

let messageSeq = 0
function userText(text: string) {
  messageSeq += 1
  return { id: `m${messageSeq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } as any
}

function assistantToolCall(id: string, name: string, args: string) {
  messageSeq += 1
  return {
    id: `m${messageSeq}`,
    role: 'assistant',
    source: { kind: 'model', provider: 'antigravity-cli', model: 'gemini-3.7-flash-low' },
    content: [{ type: 'tool-call', id, name, arguments: args }],
  } as any
}

function toolResult(callId: string, text: string) {
  messageSeq += 1
  return {
    id: `m${messageSeq}`,
    role: 'user',
    source: { kind: 'tool', callId },
    content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text }] }],
  } as any
}

async function collect(iterable: AsyncIterable<any>) {
  const chunks: any[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function toolCallIds(chunks: readonly any[]): string[] {
  return chunks.filter(chunk => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')
    .map(chunk => String(chunk.block.id))
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-low',
    sessionId: 'session-a',
    tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
    system: 'be useful',
    messages: [],
    ...overrides,
  } as any
}

test('a second step on one session continues the live child instead of spawning another', async () => {
  const { ctx, child, spawns } = harness([
    toolCallReply('call_1', 'read_file', { path: 'a.ts' }),
    messageReply('done'),
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('read a.ts')
    const step1 = await collect(adapter.stream(request({ messages: [first] })))
    const callId = toolCallIds(step1)[0]

    await collect(adapter.stream(request({
      messages: [first, assistantToolCall(callId, 'read_file', '{"path":"a.ts"}'), toolResult(callId, 'file body')],
    })))

    assert.equal(spawns.length, 1, `expected one turn spawn, got ${spawns.length}`)
    const envelopes = child.envelopes()
    assert.equal(envelopes.length, 2)
    assert.equal(envelopes[0].kind, 'full')
    assert.equal(envelopes[1].kind, 'delta')
  } finally { await adapter.dispose() }
})

test('the delta carries only the messages appended since the previous reply, and no tool catalog', async () => {
  const { ctx, child } = harness([
    toolCallReply('call_1', 'read_file', { path: 'a.ts' }),
    messageReply('done'),
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('read a.ts')
    const step1 = await collect(adapter.stream(request({ messages: [first] })))
    const callId = toolCallIds(step1)[0]
    await collect(adapter.stream(request({
      messages: [first, assistantToolCall(callId, 'read_file', '{"path":"a.ts"}'), toolResult(callId, 'file body')],
    })))

    const delta = child.envelopes()[1]
    const messages = delta.messages as any[]
    assert.equal(messages.length, 1, 'only the tool result: the vendor already has its own reply')
    assert.equal(messages[0].content[0].type, 'tool-result')
    assert.equal(delta.tools, undefined, 'the catalog is prefix, sent once')
    assert.equal(delta.system, undefined, 'the system prompt is prefix, sent once')
  } finally { await adapter.dispose() }
})

test('a tool result reaches the vendor under the id the vendor itself minted', async () => {
  const { ctx, child } = harness([
    toolCallReply('call_1', 'read_file', { path: 'a.ts' }),
    messageReply('done'),
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('read a.ts')
    const step1 = await collect(adapter.stream(request({ messages: [first] })))
    const callId = toolCallIds(step1)[0]
    assert.notEqual(callId, 'call_1', 'DSH mints its own unique id')

    await collect(adapter.stream(request({
      messages: [first, assistantToolCall(callId, 'read_file', '{"path":"a.ts"}'), toolResult(callId, 'file body')],
    })))

    const delta = child.envelopes()[1]
    const messages = delta.messages as any[]
    assert.equal(messages[0].content[0].tool_call_id, 'call_1')
  } finally { await adapter.dispose() }
})

test('a vendor that reuses one id across steps still produces distinct DSH tool-call ids', async () => {
  const { ctx } = harness([
    toolCallReply('call_1', 'read_file', { path: 'a.ts' }),
    toolCallReply('call_1', 'read_file', { path: 'b.ts' }),
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('read both')
    const step1 = await collect(adapter.stream(request({ messages: [first] })))
    const id1 = toolCallIds(step1)[0]
    const step2 = await collect(adapter.stream(request({
      messages: [first, assistantToolCall(id1, 'read_file', '{"path":"a.ts"}'), toolResult(id1, 'a body')],
    })))
    const id2 = toolCallIds(step2)[0]

    assert.notEqual(id1, id2, 'a repeated vendor id must not become a repeated DSH id')
  } finally { await adapter.dispose() }
})

test('history that no longer extends what the conversation was told rebuilds instead of sending a delta', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('first')
    await collect(adapter.stream(request({ messages: [first] })))
    // Compaction shadowed the opening message: the live conversation has
    // heard something this request no longer contains.
    await collect(adapter.stream(request({ messages: [userText('compacted summary'), userText('next')] })))

    assert.equal(spawns.length, 2, 'divergence must reopen the conversation')
  } finally { await adapter.dispose() }
})

test('a changed tool catalog rebuilds, because the catalog is prefix a delta cannot revise', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('first')
    await collect(adapter.stream(request({ messages: [first] })))
    await collect(adapter.stream(request({
      messages: [first, userText('next')],
      tools: [{ name: 'write_file', description: 'write', parameters: { type: 'object' } }],
    })))

    assert.equal(spawns.length, 2)
  } finally { await adapter.dispose() }
})

test('a changed system prompt rebuilds for the same reason', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('first')
    await collect(adapter.stream(request({ messages: [first] })))
    await collect(adapter.stream(request({ messages: [first, userText('next')], system: 'be different' })))

    assert.equal(spawns.length, 2)
  } finally { await adapter.dispose() }
})

test('an auxiliary call runs in its own child and leaves the session conversation intact', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('summary')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('first')
    await collect(adapter.stream(request({ messages: [first] })))
    // A compaction fold brings its own system prompt and its own history; it
    // must not be mistaken for the session continuing.
    await collect(adapter.stream(request({
      messages: [userText('summarize this')],
      system: 'you are a summarizer',
      purpose: 'compaction',
    })))
    await collect(adapter.stream(request({ messages: [first, userText('next')] })))

    assert.equal(spawns.length, 2, 'the fold spawned its own child; the session kept its own')
  } finally { await adapter.dispose() }
})

test('a request with no session id keeps the one-shot child it always had', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({ messages: [userText('a')], sessionId: undefined })))
    await collect(adapter.stream(request({ messages: [userText('b')], sessionId: undefined })))

    assert.equal(spawns.length, 2)
  } finally { await adapter.dispose() }
})

test('two DSH sessions get one live child each, not one shared conversation', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({ messages: [userText('a')], sessionId: 'session-a' })))
    await collect(adapter.stream(request({ messages: [userText('b')], sessionId: 'session-b' })))

    assert.equal(spawns.length, 2)
  } finally { await adapter.dispose() }
})

test('resolveModel advertises a context capacity, without which compaction never runs', async () => {
  const { ctx } = harness([messageReply('unused')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const resolved = await adapter.resolveModel('antigravity-cli', 'gemini-3.7-flash-low')
    assert.deepEqual(resolved.context, { contextWindow: primaryConfig.contextWindowTokens })
  } finally { await adapter.dispose() }
})

test('dispose closes a live conversation, so a later request cannot reach a dead child', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const first = userText('first')
  await collect(adapter.stream(request({ messages: [first] })))
  await adapter.dispose()

  await assert.rejects(
    collect(adapter.stream(request({ messages: [first, userText('next')] }))),
    /disposed/,
  )
  assert.equal(spawns.length, 1)
})

test('a live conversation reports each turn\'s own tokens, not the vendor\'s running total', async () => {
  const { ctx } = harness([
    toolCallReply('call_1', 'read_file', { path: 'a.ts' }, {
      input_tokens: 4205, output_tokens: 36, cache_read_tokens: 0, thinking_tokens: 10,
    }),
    // `agy` counts the conversation, so turn two restates turn one's tokens.
    messageReply('done', {
      input_tokens: 8606, output_tokens: 72, cache_read_tokens: 4000, thinking_tokens: 25,
    }),
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('read a.ts')
    const step1 = await collect(adapter.stream(request({ messages: [first] })))
    const callId = toolCallIds(step1)[0]
    const step2 = await collect(adapter.stream(request({
      messages: [first, assistantToolCall(callId, 'read_file', '{"path":"a.ts"}'), toolResult(callId, 'body')],
    })))

    const usage1 = step1.find(chunk => chunk.type === 'usage')?.usage
    const usage2 = step2.find(chunk => chunk.type === 'usage')?.usage
    assert.deepEqual(usage1, { inputTokens: 4205, outputTokens: 36, cacheReadTokens: 0, reasoningTokens: 10 })
    assert.deepEqual(usage2, { inputTokens: 4401, outputTokens: 36, cacheReadTokens: 4000, reasoningTokens: 15 })
  } finally { await adapter.dispose() }
})

test('a rebuilt conversation restarts the subtraction, because the new child restarts the counter', async () => {
  const { ctx } = multiHarness([
    [messageReply('one', { input_tokens: 5000, output_tokens: 40 })],
    [messageReply('two', { input_tokens: 5200, output_tokens: 45 })],
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({ messages: [userText('a')] })))
    // Divergent history: a different child, whose counter starts at zero.
    const step2 = await collect(adapter.stream(request({ messages: [userText('b'), userText('c')] })))

    const usage2 = step2.find(chunk => chunk.type === 'usage')?.usage
    assert.deepEqual(usage2, { inputTokens: 5200, outputTokens: 45 })
  } finally { await adapter.dispose() }
})

/**
 * The structured-output schema now names each tool and pins its own parameter
 * schema. The bridge previously declared `arguments: {"type":"object"}` for
 * every call, which an empty object satisfies -- so a call missing every
 * required field was well-formed as far as the vendor was concerned, failed in
 * DSH, and was retried by a model with no way to see why.
 */

function schemaArgv(spawns: readonly string[][]): Record<string, unknown> {
  const argv = spawns[0]
  const path = argv[argv.indexOf('--json-schema') + 1]
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

test('the forced output schema pins each tool by name and carries its own argument schema', async () => {
  const { ctx, spawns } = harness([messageReply('ok')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({
      messages: [userText('hi')],
      tools: [
        {
          name: 'read_file',
          description: 'read',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { path: { type: 'string' }, max_lines: { type: 'integer' } },
            required: ['path'],
          },
        },
        {
          name: 'list_dir',
          description: 'list',
          parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] },
        },
      ],
    })))

    const schema = schemaArgv(spawns) as any
    const variants = schema.properties.tool_calls.items.anyOf
    assert.equal(variants.length, 2)
    assert.deepEqual(variants[0].properties.name.enum, ['read_file'])
    assert.deepEqual(variants[0].properties.arguments.required, ['path'])
    assert.equal(variants[0].properties.arguments.properties.max_lines.type, 'integer')
    assert.deepEqual(variants[1].properties.name.enum, ['list_dir'])
  } finally { await adapter.dispose() }
})

test('a single tool skips the anyOf wrapper it does not need', async () => {
  const { ctx, spawns } = harness([messageReply('ok')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({ messages: [userText('hi')] })))
    const schema = schemaArgv(spawns) as any
    assert.deepEqual(schema.properties.tool_calls.items.properties.name.enum, ['read_file'])
  } finally { await adapter.dispose() }
})

test('a tool schema the vendor subset cannot express falls back alone, not for the whole catalog', async () => {
  const { ctx, spawns } = harness([messageReply('ok')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({
      messages: [userText('hi')],
      tools: [
        {
          name: 'exotic',
          description: 'composite',
          // `oneOf` cannot be dropped without changing what the schema means.
          parameters: { type: 'object', properties: { value: { oneOf: [{ type: 'string' }, { type: 'number' }] } } },
        },
        {
          name: 'plain',
          description: 'plain',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      ],
    })))

    const variants = (schemaArgv(spawns) as any).properties.tool_calls.items.anyOf
    assert.deepEqual(variants[0].properties.arguments, { type: 'object' }, 'the exotic tool alone loses its typing')
    assert.deepEqual(variants[1].properties.arguments.required, ['path'], 'its neighbour keeps it')
  } finally { await adapter.dispose() }
})

test('annotation-only keywords are dropped rather than abandoning the tool', async () => {
  const { ctx, spawns } = harness([messageReply('ok')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({
      messages: [userText('hi')],
      tools: [{
        name: 'read_file',
        description: 'read',
        parameters: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          title: 'Read',
          properties: { path: { type: 'string', format: 'uri', description: 'the path' }, mode: { const: 'text' } },
          required: ['path'],
        },
      }],
    })))

    const args = (schemaArgv(spawns) as any).properties.tool_calls.items.properties.arguments
    assert.equal(args.$schema, undefined)
    assert.equal(args.title, undefined)
    assert.equal(args.properties.path.format, undefined)
    assert.equal(args.properties.path.description, 'the path', 'description is meaning, not noise')
    assert.deepEqual(args.properties.mode.enum, ['text'], 'const becomes a one-member enum')
  } finally { await adapter.dispose() }
})

test('a request with no tools keeps the generic schema, so nothing forces a tool call', async () => {
  const { ctx, spawns } = harness([messageReply('ok')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({ messages: [userText('hi')], tools: [] })))
    const schema = schemaArgv(spawns) as any
    assert.deepEqual(schema.properties.tool_calls.items.properties.arguments, { type: 'object' })
  } finally { await adapter.dispose() }
})

test("a delta never echoes the model's own reply back at it", async () => {
  const { ctx, child } = harness([
    toolCallReply('call_1', 'read_file', { path: 'a.ts' }),
    messageReply('done'),
  ])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('read a.ts')
    const step1 = await collect(adapter.stream(request({ messages: [first] })))
    const callId = toolCallIds(step1)[0]
    await collect(adapter.stream(request({
      messages: [first, assistantToolCall(callId, 'read_file', '{"path":"a.ts"}'), toolResult(callId, 'body')],
    })))

    const roles = ((child.envelopes()[1].messages as any[]) ?? []).map(m => m.role)
    assert.ok(!roles.includes('assistant'), `the vendor already said this: ${JSON.stringify(roles)}`)
  } finally { await adapter.dispose() }
})

test('an assistant message from another route is news, so a delta still carries it', async () => {
  const { ctx, child } = harness([messageReply('one'), messageReply('two')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('first')
    await collect(adapter.stream(request({ messages: [first] })))
    const foreign = {
      id: 'm-foreign',
      role: 'assistant',
      source: { kind: 'model', provider: 'codex-app-server', model: 'gpt-5.6' },
      content: [{ type: 'text', text: 'replayed from elsewhere' }],
    } as any
    await collect(adapter.stream(request({ messages: [first, foreign, userText('next')] })))

    const roles = ((child.envelopes()[1].messages as any[]) ?? []).map(m => m.role)
    assert.deepEqual(roles, ['assistant', 'user'])
  } finally { await adapter.dispose() }
})

test('a rewritten message keeping its id still rebuilds, because the vendor heard the original', async () => {
  const { ctx, spawns } = multiHarness([[messageReply('one')], [messageReply('two')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = userText('first')
    const bulky = toolResult('c1', 'x'.repeat(200))
    await collect(adapter.stream(request({ messages: [first, bulky] })))

    // Exactly what the tool-result pruner does: same id, truncated content.
    const pruned = { ...bulky, content: [{ ...bulky.content[0], content: [{ type: 'text', text: 'x…(pruned)' }] }] }
    await collect(adapter.stream(request({ messages: [first, pruned, userText('next')] })))

    assert.equal(spawns.length, 2, 'a content rewrite must reach the vendor as a rebuild')
  } finally { await adapter.dispose() }
})

test('maxTokens is refused on an ordinary turn but accepted as an auxiliary budget hint', async () => {
  const { ctx } = multiHarness([[messageReply('one')], [messageReply('summary')]])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await assert.rejects(
      collect(adapter.stream(request({ messages: [userText('a')], maxTokens: 8192 }))),
      /maxTokens/,
    )
    // Compaction always sends maxTokens and cannot be configured not to, so
    // refusing it here left the route with no working compaction at all.
    const folded = await collect(adapter.stream(request({
      messages: [userText('summarize')],
      maxTokens: 8192,
      purpose: 'compaction',
    })))
    assert.ok(folded.some(chunk => chunk.type === 'finish'))
  } finally { await adapter.dispose() }
})

test('an auxiliary call gets a schema that cannot express a tool call at all', async () => {
  const { ctx, spawns } = harness([messageReply('a summary')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    // Compaction replays the conversation's own tools on purpose, to stay
    // cache-aligned with the last routed request. Offered them alongside an
    // unfinished task, the model answered by calling one -- leaving `text`
    // empty and compaction dead with "no text summary content".
    await collect(adapter.stream(request({
      messages: [userText('summarize')],
      purpose: 'compaction',
      maxTokens: 8192,
    })))

    const schema = schemaArgv(spawns) as any
    assert.deepEqual(schema.properties.kind.enum, ['message'])
    assert.equal(schema.properties.tool_calls, undefined, 'a tool call must be unexpressible, not merely discouraged')
  } finally { await adapter.dispose() }
})

test('an auxiliary reply omitting tool_calls entirely is read as a plain message', async () => {
  const { ctx } = harness([{
    conversation_id: 'c1',
    status: 'SUCCESS',
    // Exactly what the message-only schema produces: no `tool_calls` key.
    structured_output: { kind: 'message', text: '## Primary Request and Intent\n- do the thing' },
  }])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const chunks = await collect(adapter.stream(request({
      messages: [userText('summarize')],
      purpose: 'compaction',
    })))
    const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
    assert.match(text, /Primary Request and Intent/)
    assert.equal(chunks.find(c => c.type === 'finish')?.reason.kind, 'stop')
  } finally { await adapter.dispose() }
})

test('an ordinary turn still gets the tool-typed schema', async () => {
  const { ctx, spawns } = harness([messageReply('ok')])
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await collect(adapter.stream(request({ messages: [userText('hi')] })))
    const schema = schemaArgv(spawns) as any
    assert.deepEqual(schema.properties.kind.enum, ['message', 'tool_calls'])
    assert.ok(schema.properties.tool_calls)
  } finally { await adapter.dispose() }
})
