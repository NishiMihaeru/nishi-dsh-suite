import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  CODEX_MEMORY_DYNAMIC_TOOL,
  createCodexSubagentMemory,
} from '../src/memory.js'
import { CodexAppServerWire } from '../src/wire.js'

test('Codex memory helper obtains context through the Cordis projectMemory service', async () => {
  const calls: any[] = []
  const context = {
    projectRoot: '/workspace',
    renderedBootstrap: '# DSH Project Context\nproject memory',
    async readTopic(topic: string, signal?: AbortSignal) {
      calls.push({ kind: 'read', topic, signal })
      return { topic, exists: true, content: `content:${topic}` }
    },
  }
  const service = {
    async createSubagentContext(options: any) {
      calls.push({ kind: 'create', ...options })
      return context
    },
  }
  const controller = new AbortController()

  const memory = await createCodexSubagentMemory(service as any, '/workspace', controller.signal)
  assert.equal(memory.bootstrap, context.renderedBootstrap)
  assert.deepEqual(calls[0], {
    kind: 'create',
    cwd: '/workspace',
    signal: controller.signal,
  })
  assert.deepEqual(await memory.read('architecture', controller.signal), {
    topic: 'architecture',
    exists: true,
    content: 'content:architecture',
  })
  assert.deepEqual(calls[1], {
    kind: 'read',
    topic: 'architecture',
    signal: controller.signal,
  })
})

test('Codex dynamic tool schema exposes only memory_read(topic)', () => {
  assert.deepEqual(CODEX_MEMORY_DYNAMIC_TOOL, {
    name: 'memory_read',
    description: 'Read one DSH-owned durable project memory topic. Read-only; paths and filenames are not accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  })
  assert.doesNotMatch(JSON.stringify(CODEX_MEMORY_DYNAMIC_TOOL), /memory_write|memory_edit/)
})

test('Codex wire advertises memory_read and handles item/tool/call through host memory reader', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  const reads: Array<{ topic: string; signal?: AbortSignal }> = []
  const memory = {
    bootstrap: '# DSH Project Context\nproject memory',
    async read(topic: string, signal?: AbortSignal) {
      reads.push({ topic, signal })
      return { topic, exists: true, content: 'durable result' }
    },
  }
  const wire = new CodexAppServerWire(input, output, 'never', memory as any)
  const sent: any[] = []

  output.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (!line) continue
      const msg = JSON.parse(line)
      sent.push(msg)
      if (msg.method === 'initialize') {
        assert.equal(msg.params.capabilities.experimentalApi, true)
        input.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'codex', version: '0.147.0' } } }) + '\n')
      } else if (msg.method === 'thread/start') {
        assert.deepEqual(msg.params.dynamicTools, [CODEX_MEMORY_DYNAMIC_TOOL])
        input.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'th_mem', ephemeral: true } } }) + '\n')
      } else if (msg.method === 'turn/start') {
        assert.equal(msg.params.input[0].text, '# DSH Project Context\nproject memory')
        assert.equal(msg.params.input[1].text, '# Delegated Task\n\nDo task')
        input.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turn: { id: 'turn_mem', status: 'in_progress' } } }) + '\n')
        input.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 'dynamic_1',
          method: 'item/tool/call',
          params: {
            threadId: 'th_mem',
            turnId: 'turn_mem',
            callId: 'call_mem',
            namespace: null,
            tool: 'memory_read',
            arguments: { topic: 'architecture' },
          },
        }) + '\n')
      } else if (msg.id === 'dynamic_1') {
        assert.deepEqual(msg.result, {
          contentItems: [
            {
              type: 'inputText',
              text: JSON.stringify({
                topic: 'architecture',
                exists: true,
                content: 'durable result',
              }),
            },
          ],
          success: true,
        })
        input.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/completed',
          params: {
            threadId: 'th_mem',
            turnId: 'turn_mem',
            item: { type: 'agentMessage', phase: 'final_answer', text: 'Used memory.' },
          },
        }) + '\n')
        input.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: {
            threadId: 'th_mem',
            turn: { id: 'turn_mem', status: 'completed' },
          },
        }) + '\n')
      }
    }
  })

  wire.start()
  const controller = new AbortController()
  await wire.initialize(controller.signal)
  await wire.startThread('/workspace', controller.signal)
  const result = await wire.runTurn(['Do task'], controller.signal)

  assert.equal(reads.length, 1)
  assert.equal(reads[0]?.topic, 'architecture')
  assert.equal(reads[0]?.signal, controller.signal)
  assert.deepEqual(result, {
    output: [{ type: 'text', text: 'Used memory.' }],
    stopReason: 'completed',
  })
  wire.close()
})

test('Codex wire fails dynamic memory reads safely and rejects unknown tools', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  const memory = {
    bootstrap: null,
    async read() {
      throw new Error('/home/<username>/.dsh/memory/secret.md')
    },
  }
  const wire = new CodexAppServerWire(input, output, 'never', memory as any)
  const responses: any[] = []

  output.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (!line) continue
      responses.push(JSON.parse(line))
    }
  })

  wire.start()
  input.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 'bad_read',
    method: 'item/tool/call',
    params: {
      threadId: 'missing',
      turnId: 'missing',
      callId: 'call_bad',
      namespace: null,
      tool: 'memory_read',
      arguments: { topic: 'architecture' },
    },
  }) + '\n')

  await new Promise((resolve) => setImmediate(resolve))
  const serialized = JSON.stringify(responses)
  assert.doesNotMatch(serialized, /\/home\/private/)
  wire.close()
})
