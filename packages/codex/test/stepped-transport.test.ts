import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'
import {
  CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS,
  CodexAppServerAdapter,
} from '../src/codex-plugin-dsh/adapter.ts'
import {
  codexDecisionDigest,
  codexHistoryDigest,
  prepareCodexHistory,
  type CodexReplayState,
} from '../src/codex-plugin-dsh/history.ts'
import { codexOutputSchema } from '../src/codex-plugin-dsh/stepped-schema.ts'

const config = {
  executable: 'codex',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 600_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
  modelPageSize: 100,
}

function createFixture(overrides: { tools?: ToolSchema[] } = {}) {
  const requests: Array<{ method: string; params: any }> = []
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'thread-test' } }
      if (method === 'turn/start') return { turn: { id: 'turn-test' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() {},
  }

  const ctx = {
    attachments: {},
    sessions: {
      get: (id: string) => (id === 'session-test' ? { header: { cwd: '/workspace' } } : undefined),
    },
  }

  const adapter = new CodexAppServerAdapter(ctx as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({})

  const options = {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    sessionId: 'session-test',
    messages: [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
    ],
    ...overrides.tools !== undefined ? { tools: overrides.tools } : {},
  } as any

  return { adapter, requests, options }
}

/** A one-tool catalog, so the turn is opened WITH an outputSchema and its final
 *  message is therefore a decision to parse rather than ordinary prose. */
const DECISION_TOOLS: ToolSchema[] = [{
  name: 'noop',
  description: 'Does nothing.',
  parameters: { type: 'object', properties: { why: { type: 'string' } }, required: ['why'] },
}]

async function waitForActiveTurn(adapter: any, sessionId: string): Promise<any> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const active = adapter.activeTurns.get(sessionId)
    if (active !== undefined) return active
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('test: active turn was never registered')
}

async function collectChunks(
  adapter: any,
  options: any,
  setupEvents: (active: any) => void,
): Promise<StreamChunk[]> {
  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const pending = iterator.next()
  const active = await waitForActiveTurn(adapter, options.sessionId)
  setupEvents(active)
  const chunks: StreamChunk[] = []
  let result = await pending
  while (!result.done) {
    chunks.push(result.value)
    result = await iterator.next()
  }
  return chunks
}

test('1. turn/start carries an outputSchema built from the request tools, and thread/start carries no dynamicTools key at all', async () => {
  const tools: ToolSchema[] = [{
    name: 'bash',
    description: 'Run shell commands',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  }]
  const { adapter, requests, options } = createFixture({ tools })
  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const pending = iterator.next()
  const active = await waitForActiveTurn(adapter, 'session-test')

  active.events.push({
    method: 'item/completed',
    params: {
      threadId: 'thread-test',
      turnId: 'turn-test',
      item: {
        id: 'msg-1',
        type: 'agentMessage',
        phase: 'final_answer',
        text: JSON.stringify({ decision: { kind: 'final', message: 'done' } }),
      },
    },
  })
  active.events.push({
    method: 'turn/completed',
    params: {
      threadId: 'thread-test',
      turn: { id: 'turn-test', status: 'completed' },
    },
  })

  let result = await pending
  while (!result.done) {
    result = await iterator.next()
  }

  const threadStart = requests.find(r => r.method === 'thread/start')
  assert.ok(threadStart, 'thread/start request must be made')
  assert.equal('dynamicTools' in threadStart.params, false, 'thread/start must carry no dynamicTools key')

  const turnStart = requests.find(r => r.method === 'turn/start')
  assert.ok(turnStart, 'turn/start request must be made')
  assert.ok('outputSchema' in turnStart.params, 'turn/start must carry outputSchema')
  assert.deepEqual(turnStart.params.outputSchema, codexOutputSchema(tools))
})

test('2. a request with no tools sends no outputSchema key at all', async () => {
  const { adapter, requests, options } = createFixture()
  const iterator = adapter.stream(options)[Symbol.asyncIterator]()
  const pending = iterator.next()
  const active = await waitForActiveTurn(adapter, 'session-test')

  active.events.push({
    method: 'item/completed',
    params: {
      threadId: 'thread-test',
      turnId: 'turn-test',
      item: {
        id: 'msg-1',
        type: 'agentMessage',
        phase: 'final_answer',
        text: JSON.stringify({ decision: { kind: 'final', message: 'done' } }),
      },
    },
  })
  active.events.push({
    method: 'turn/completed',
    params: {
      threadId: 'thread-test',
      turn: { id: 'turn-test', status: 'completed' },
    },
  })

  let result = await pending
  while (!result.done) {
    result = await iterator.next()
  }

  const turnStart = requests.find(r => r.method === 'turn/start')
  assert.ok(turnStart, 'turn/start request must be made')
  assert.equal('outputSchema' in turnStart.params, false, 'turn/start must carry no outputSchema key when no tools are present')
})

test('3. a turn whose decision is final yields one text block with the decision message and finish reason stop, and no JSON reaches the stream', async () => {
  const tools: ToolSchema[] = [{
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }]
  const { adapter, options } = createFixture({ tools })
  const userMessage = 'The result of the calculation is 42.'
  const chunks = await collectChunks(adapter, options, active => {
    active.events.push({
      method: 'item/started',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer' },
      },
    })
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'msg-1',
        delta: JSON.stringify({ decision: { kind: 'final', message: userMessage } }),
      },
    })
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          phase: 'final_answer',
          text: JSON.stringify({ decision: { kind: 'final', message: userMessage } }),
        },
      },
    })
    active.events.push({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed' },
      },
    })
  })

  const blockStart = chunks.find(c => c.type === 'block-start')
  assert.ok(blockStart && blockStart.type === 'block-start')
  assert.equal(blockStart.blockType, 'text')

  const textDelta = chunks.find(c => c.type === 'text-delta')
  assert.ok(textDelta && textDelta.type === 'text-delta')
  assert.equal(textDelta.text, userMessage)

  const blockEnd = chunks.find(c => c.type === 'block-end')
  assert.ok(blockEnd && blockEnd.type === 'block-end')
  assert.deepEqual(blockEnd.block, { type: 'text', text: userMessage })

  const finish = chunks.find(c => c.type === 'finish')
  assert.ok(finish && finish.type === 'finish')
  assert.equal(finish.reason.kind, 'stop')

  // Verify no raw JSON reached the stream in any chunk
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      assert.doesNotMatch(chunk.text, /"decision"/)
      assert.doesNotMatch(chunk.text, /"kind"/)
    }
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      assert.doesNotMatch(chunk.block.text, /"decision"/)
      assert.doesNotMatch(chunk.block.text, /"kind"/)
    }
  }
})

test('4. the raw JSON deltas of the decision produce no text-delta chunks — assert on the chunk sequence, not on the final text', async () => {
  const tools: ToolSchema[] = [{
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }]
  const { adapter, options } = createFixture({ tools })
  const chunks = await collectChunks(adapter, options, active => {
    active.events.push({
      method: 'item/started',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer' },
      },
    })
    // 10 raw JSON fragments
    const fragments = ['{"', 'decision', '":{"', 'kind', '":"', 'final', '","', 'message', '":"', 'Hello world!"}}']
    for (const delta of fragments) {
      active.events.push({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'thread-test',
          turnId: 'turn-test',
          itemId: 'msg-1',
          delta,
        },
      })
    }
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          phase: 'final_answer',
          text: '{"decision":{"kind":"final","message":"Hello world!"}}',
        },
      },
    })
    active.events.push({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed' },
      },
    })
  })

  // Exact chunk sequence assertion: the 10 raw deltas produced 0 text-delta chunks
  const chunkTypes = chunks.map(c => c.type)
  assert.deepEqual(chunkTypes, ['block-start', 'text-delta', 'block-end', 'finish'])
  assert.equal(chunks.filter(c => c.type === 'text-delta').length, 1)
  const textDelta = chunks[1] as Extract<StreamChunk, { type: 'text-delta' }>
  assert.equal(textDelta.text, 'Hello world!')
})

test('5. a commentary message still streams as reasoning while a decision is buffered in the same turn', async () => {
  const tools: ToolSchema[] = [{
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }]
  const { adapter, options } = createFixture({ tools })
  const chunks = await collectChunks(adapter, options, active => {
    // 1. Commentary message
    active.events.push({
      method: 'item/started',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'reasoning-1', type: 'agentMessage', phase: 'commentary' },
      },
    })
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'reasoning-1',
        delta: 'Thinking about ',
      },
    })
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'reasoning-1',
        delta: 'the problem...',
      },
    })
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'reasoning-1',
          type: 'agentMessage',
          phase: 'commentary',
          text: 'Thinking about the problem...',
        },
      },
    })

    // 2. Decision message (buffered)
    active.events.push({
      method: 'item/started',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'msg-decision', type: 'agentMessage', phase: 'final_answer' },
      },
    })
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'msg-decision',
        delta: '{"decision":{"kind":"final","message":"Answer"}}',
      },
    })
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-decision',
          type: 'agentMessage',
          phase: 'final_answer',
          text: '{"decision":{"kind":"final","message":"Answer"}}',
        },
      },
    })
    active.events.push({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed' },
      },
    })
  })

  const chunkTypes = chunks.map(c => c.type)
  assert.deepEqual(chunkTypes, [
    'block-start', // reasoning index 0
    'reasoning-delta',
    'reasoning-delta',
    'block-end',   // reasoning index 0
    'block-start', // text index 1
    'text-delta',
    'block-end',   // text index 1
    'finish',
  ])

  const reasoningDeltas = chunks.filter(c => c.type === 'reasoning-delta')
  assert.equal(reasoningDeltas.length, 2)
  assert.equal((chunks[0] as any).blockType, 'reasoning')
  assert.equal((chunks[3] as any).block.text, 'Thinking about the problem...')

  assert.equal((chunks[4] as any).blockType, 'text')
  assert.equal((chunks[5] as any).text, 'Answer')
  assert.equal((chunks[6] as any).block.text, 'Answer')
})

test('6. a turn whose decision is a tool call yields one tool-call block with a DSH-minted id, finish reason tool-calls, and replay state whose decisionDigest matches the emitted block', async () => {
  const tools: ToolSchema[] = [{
    name: 'fetch_data',
    description: 'Fetch remote data',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  }]
  const { adapter, options } = createFixture({ tools })
  const toolArgs = { url: 'https://example.com/api' }
  const decisionText = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'fetch_data',
      arguments: toolArgs,
    },
  })

  const chunks = await collectChunks(adapter, options, active => {
    active.events.push({
      method: 'item/started',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer' },
      },
    })
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'msg-1',
        delta: decisionText,
      },
    })
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          phase: 'final_answer',
          text: decisionText,
        },
      },
    })
    active.events.push({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed' },
      },
    })
  })

  const chunkTypes = chunks.map(c => c.type)
  assert.deepEqual(chunkTypes, ['block-start', 'tool-call-delta', 'block-end', 'finish'])

  const blockStart = chunks[0] as Extract<StreamChunk, { type: 'block-start' }>
  assert.equal(blockStart.blockType, 'tool-call')

  const toolDelta = chunks[1] as Extract<StreamChunk, { type: 'tool-call-delta' }>
  assert.equal(toolDelta.name, 'fetch_data')
  assert.equal(toolDelta.argumentsDelta, JSON.stringify(toolArgs))
  assert.match(toolDelta.id, /^codex-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

  const blockEnd = chunks[2] as Extract<StreamChunk, { type: 'block-end' }>
  assert.equal(blockEnd.block.type, 'tool-call')
  const toolBlock = blockEnd.block as Extract<typeof blockEnd.block, { type: 'tool-call' }>
  assert.equal(toolBlock.name, 'fetch_data')
  assert.equal(toolBlock.arguments, JSON.stringify(toolArgs))
  assert.equal(toolBlock.id, toolDelta.id)

  const finish = chunks[3] as Extract<StreamChunk, { type: 'finish' }>
  assert.equal(finish.reason.kind, 'tool-calls')
  assert.ok(finish.replayState, 'finish chunk must carry replay state')
  const replay = finish.replayState.response as CodexReplayState
  assert.ok(replay, 'replayState must have response object')
  assert.ok(replay.decisionDigest, 'replayState must carry decisionDigest')
  assert.equal(replay.decisionDigest, codexDecisionDigest([toolBlock]))
})

test('7. two non-commentary agent messages in one turn throw', async () => {
  const tools: ToolSchema[] = [{
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
  }]
  const { adapter, options } = createFixture({ tools })
  await assert.rejects(
    async () => {
      await collectChunks(adapter, options, active => {
        // First non-commentary agent message
        active.events.push({
          method: 'item/started',
          params: {
            threadId: 'thread-test',
            turnId: 'turn-test',
            item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer' },
          },
        })
        active.events.push({
          method: 'item/completed',
          params: {
            threadId: 'thread-test',
            turnId: 'turn-test',
            item: {
              id: 'msg-1',
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify({ decision: { kind: 'final', message: 'one' } }),
            },
          },
        })
        // Second non-commentary agent message in the same turn
        active.events.push({
          method: 'item/started',
          params: {
            threadId: 'thread-test',
            turnId: 'turn-test',
            item: { id: 'msg-2', type: 'agentMessage', phase: 'final_answer' },
          },
        })
      })
    },
    /second non-commentary agent message/,
  )
})

test('8. a checkpoint whose decisionDigest no longer matches its assistant message is passed over and counted', async () => {
  const provider = 'codex-app-server'
  const noImages = async (): Promise<string> => { throw new Error('no images') }
  const u0: Message = { id: 'u-0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'call tool' }] }
  const toolCallBlock = { type: 'tool-call' as const, id: 'call-1', name: 'search', arguments: '{"q":"original"}' }
  const originalDigest = codexDecisionDigest([toolCallBlock])
  const a0: Message = {
    id: 'a-0',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 2,
          threadId: 'thread-mismatch',
          turnId: 'turn-mismatch',
          sessionId: 'session-test',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u0]),
          decisionDigest: originalDigest,
        },
      },
    },
    content: [
      { type: 'tool-call', id: 'call-1', name: 'search', arguments: '{"q":"tampered"}' },
    ],
  }
  const u1: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] }

  const history = await prepareCodexHistory([u0, a0, u1], provider, noImages, 'session-test')

  assert.equal(history.checkpoint, undefined)
  assert.equal(history.skippedCheckpoints, 1)
  assert.equal(history.injectItems.length, 2)
})

test('9. a checkpoint with no decisionDigest on a text-only response is still accepted', async () => {
  const provider = 'codex-app-server'
  const noImages = async (): Promise<string> => { throw new Error('no images') }
  const u0: Message = { id: 'u-0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }
  const a0: Message = {
    id: 'a-0',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 2,
          threadId: 'thread-text-only',
          turnId: 'turn-text-only',
          sessionId: 'session-test',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u0]),
        },
      },
    },
    content: [
      { type: 'text', text: 'plain text response' },
    ],
  }
  const u1: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] }

  const history = await prepareCodexHistory([u0, a0, u1], provider, noImages, 'session-test')

  assert.equal(history.checkpoint?.turnId, 'turn-text-only')
  assert.equal(history.skippedCheckpoints, 0)
  assert.deepEqual(history.injectItems, [])
})

test('10. finding 1: delta for a commentary message before item/started followed by final_answer succeeds', async () => {
  const tools: ToolSchema[] = [{
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }]
  const { adapter, options } = createFixture({ tools })
  const reasoningText = 'Working on the solution...'
  const finalText = 'Here is the final answer.'

  const chunks = await collectChunks(adapter, options, active => {
    // 1. Delta for commentary message before its item/started
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'msg-c',
        delta: reasoningText,
      },
    })
    // 2. item/completed for msg-c with phase: 'commentary'
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-c',
          type: 'agentMessage',
          phase: 'commentary',
          text: reasoningText,
        },
      },
    })
    // 3. Real final_answer decision
    active.events.push({
      method: 'item/started',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'msg-final', type: 'agentMessage', phase: 'final_answer' },
      },
    })
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'msg-final',
        delta: JSON.stringify({ decision: { kind: 'final', message: finalText } }),
      },
    })
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-final',
          type: 'agentMessage',
          phase: 'final_answer',
          text: JSON.stringify({ decision: { kind: 'final', message: finalText } }),
        },
      },
    })
    // 4. turn/completed
    active.events.push({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed' },
      },
    })
  })

  // Assert the turn SUCCEEDS
  assert.ok(chunks.length > 0, 'stream must yield chunks')

  // Assert no chunk carries a negative index
  for (const chunk of chunks) {
    if ('index' in chunk) {
      assert.ok(chunk.index >= 0, `chunk ${chunk.type} has negative index ${chunk.index}`)
    }
  }

  // Assert reasoning block has block-start before block-end
  const reasoningStartIdx = chunks.findIndex(c => c.type === 'block-start' && c.blockType === 'reasoning')
  const reasoningEndIdx = chunks.findIndex(c => c.type === 'block-end' && c.block.type === 'reasoning')
  assert.notEqual(reasoningStartIdx, -1, 'must have reasoning block-start')
  assert.notEqual(reasoningEndIdx, -1, 'must have reasoning block-end')
  assert.ok(reasoningStartIdx < reasoningEndIdx, 'reasoning block-start must precede block-end')

  // Assert emitted text is the decision's message
  const textEnd = chunks.find(c => c.type === 'block-end' && c.block.type === 'text') as any
  assert.ok(textEnd, 'must have text block-end')
  assert.equal(textEnd.block.text, finalText)

  const textDelta = chunks.find(c => c.type === 'text-delta') as any
  assert.ok(textDelta, 'must have text-delta')
  assert.equal(textDelta.text, finalText)

  const finish = chunks.find(c => c.type === 'finish') as any
  assert.ok(finish, 'must have finish chunk')
  assert.equal(finish.reason.kind, 'stop')
})

test('11. delta-first message that turns out to be the decision parses and finishes normally', async () => {
  const tools: ToolSchema[] = [{
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }]
  const { adapter, options } = createFixture({ tools })
  const userMessage = 'Result calculated without prior started event.'
  const decisionPayload = JSON.stringify({ decision: { kind: 'final', message: userMessage } })

  const chunks = await collectChunks(adapter, options, active => {
    // 1. Delta for decision message before item/started
    active.events.push({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        itemId: 'msg-decision',
        delta: decisionPayload,
      },
    })
    // 2. item/completed for msg-decision with phase: 'final_answer'
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: {
          id: 'msg-decision',
          type: 'agentMessage',
          phase: 'final_answer',
          text: decisionPayload,
        },
      },
    })
    // 3. turn/completed
    active.events.push({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed' },
      },
    })
  })

  // Assert no negative indices
  for (const chunk of chunks) {
    if ('index' in chunk) {
      assert.ok(chunk.index >= 0, `chunk ${chunk.type} has negative index ${chunk.index}`)
    }
  }

  const chunkTypes = chunks.map(c => c.type)
  assert.deepEqual(chunkTypes, ['block-start', 'text-delta', 'block-end', 'finish'])

  const textDelta = chunks.find(c => c.type === 'text-delta') as any
  assert.equal(textDelta.text, userMessage)

  const blockEnd = chunks.find(c => c.type === 'block-end') as any
  assert.deepEqual(blockEnd.block, { type: 'text', text: userMessage })

  const finish = chunks.find(c => c.type === 'finish') as any
  assert.equal(finish.reason.kind, 'stop')
})

test('12. an unknown phase string throws the unknown agent message phase error', async () => {
  const { adapter, options } = createFixture()
  await assert.rejects(
    async () => {
      await collectChunks(adapter, options, active => {
        active.events.push({
          method: 'item/started',
          params: {
            threadId: 'thread-test',
            turnId: 'turn-test',
            item: { id: 'msg-unknown', type: 'agentMessage', phase: 'summary' },
          },
        })
      })
    },
    /App Server returned unknown agent message phase "summary"/,
  )

  await assert.rejects(
    async () => {
      await collectChunks(adapter, options, active => {
        active.events.push({
          method: 'item/completed',
          params: {
            threadId: 'thread-test',
            turnId: 'turn-test',
            item: { id: 'msg-unknown', type: 'agentMessage', phase: 'summary', text: 'summary text' },
          },
        })
      })
    },
    /App Server returned unknown agent message phase "summary"/,
  )
})

test('13. a final decision with an empty message fails with without a final answer, real message succeeds', async () => {
  // 1. Empty message fails
  {
    const { adapter, options } = createFixture({ tools: DECISION_TOOLS })
    await assert.rejects(
      async () => {
        await collectChunks(adapter, options, active => {
          active.events.push({
            method: 'item/completed',
            params: {
              threadId: 'thread-test',
              turnId: 'turn-test',
              item: {
                id: 'msg-1',
                type: 'agentMessage',
                phase: 'final_answer',
                text: JSON.stringify({ decision: { kind: 'final', message: '' } }),
              },
            },
          })
          active.events.push({
            method: 'turn/completed',
            params: {
              threadId: 'thread-test',
              turn: { id: 'turn-test', status: 'completed' },
            },
          })
        })
      },
      /App Server completed without a final answer or image/,
    )
  }

  // 2. Whitespace-only message fails
  {
    const { adapter, options } = createFixture({ tools: DECISION_TOOLS })
    await assert.rejects(
      async () => {
        await collectChunks(adapter, options, active => {
          active.events.push({
            method: 'item/completed',
            params: {
              threadId: 'thread-test',
              turnId: 'turn-test',
              item: {
                id: 'msg-1',
                type: 'agentMessage',
                phase: 'final_answer',
                text: JSON.stringify({ decision: { kind: 'final', message: '   \n\t  ' } }),
              },
            },
          })
          active.events.push({
            method: 'turn/completed',
            params: {
              threadId: 'thread-test',
              turn: { id: 'turn-test', status: 'completed' },
            },
          })
        })
      },
      /App Server completed without a final answer or image/,
    )
  }

  // 3. Real message succeeds
  {
    const { adapter, options } = createFixture({ tools: DECISION_TOOLS })
    const chunks = await collectChunks(adapter, options, active => {
      active.events.push({
        method: 'item/completed',
        params: {
          threadId: 'thread-test',
          turnId: 'turn-test',
          item: {
            id: 'msg-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: JSON.stringify({ decision: { kind: 'final', message: 'Valid non-empty answer' } }),
          },
        },
      })
      active.events.push({
        method: 'turn/completed',
        params: {
          threadId: 'thread-test',
          turn: { id: 'turn-test', status: 'completed' },
        },
      })
    })

    const textDelta = chunks.find(c => c.type === 'text-delta') as any
    assert.ok(textDelta, 'must yield text-delta')
    assert.equal(textDelta.text, 'Valid non-empty answer')
    const finish = chunks.find(c => c.type === 'finish') as any
    assert.equal(finish.reason.kind, 'stop')
  }
})

test('developer instructions mention neither dynamic-tool namespace nor dynamicTools, and instruct passing null for unasked optionals', () => {
  assert.equal(
    CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS.includes('dynamic-tool'),
    false,
    'developer instructions must not mention dynamic-tool',
  )
  assert.equal(
    CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS.includes('dynamicTools'),
    false,
    'developer instructions must not mention dynamicTools',
  )
  assert.equal(
    CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS.includes('dsh dynamic-tool'),
    false,
    'developer instructions must not mention dsh dynamic-tool namespace',
  )
  assert.match(
    CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS,
    /for an optional parameter you were not asked to set, pass null rather than inventing a value/i,
    'developer instructions must instruct model to pass null for unasked optional parameters',
  )
})


test('15. a primary request with no tools is unconstrained: prose comes back as prose, and it still carries replay state', async () => {
  // Live acceptance caught this and no unit test did, because every one of them
  // supplied tools. `codexOutputSchema` returns nothing for an empty catalog, so
  // the model is never asked for JSON -- but the decision parse used to run
  // anyway and failed the turn with `response is not valid JSON`. A toolless
  // primary request is unconstrained like an auxiliary one, yet unlike an
  // auxiliary one it is a real conversation turn and must still checkpoint.
  const { adapter, options } = createFixture()
  const chunks = await collectChunks(adapter, options, active => {
    active.events.push({
      method: 'item/completed',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer', text: 'CODEX_PRIMARY_OK' },
      },
    })
    active.events.push({
      method: 'turn/completed',
      params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed' } },
    })
  })

  const text = chunks.find(c => c.type === 'text-delta') as any
  assert.ok(text, 'the prose answer must reach DSH as text')
  assert.equal(text.text, 'CODEX_PRIMARY_OK')

  const finish = chunks.find(c => c.type === 'finish') as any
  assert.equal(finish.reason.kind, 'stop')
  assert.ok(finish.replayState, 'a toolless PRIMARY turn still checkpoints, unlike an auxiliary one')
})
