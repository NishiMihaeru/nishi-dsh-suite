import assert from 'node:assert/strict'
import test from 'node:test'
import { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'
import { codexToolSignature } from '../src/codex-plugin-dsh/tools.ts'

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

function messages() {
  const toolSignature = codexToolSignature(undefined)
  return [
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'first question' }],
    },
    {
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'codex-app-server',
        replayState: {
          response: {
            kind: 'codex-app-server',
            version: 1,
            threadId: 'thread-a',
            turnId: 'turn-a',
            sessionId: 'session-a',
            toolSignature,
          },
        },
      },
      content: [
        { type: 'reasoning', text: 'provider reasoning must not be replayed' },
        { type: 'text', text: 'first answer' },
      ],
    },
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'second question' }],
    },
  ] as any
}

test('missing Codex checkpoint rebuilds a new thread from canonical DSH history', async () => {
  const requests: Array<{ method: string; params: any }> = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string, params: any) {
      requests.push({ method, params })
      if (method === 'thread/fork') {
        throw new JsonRpcResponseError(-32600, 'thread not found: thread-a')
      }
      if (method === 'thread/start') return { thread: { id: 'thread-rebuilt' } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') return { turn: { id: 'turn-rebuilt' } }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const adapter = new CodexAppServerAdapter({ attachments: {} } as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  const active = await (adapter as any).startTurn({
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    messages: messages(),
  }, 'session-a', '/workspace')

  assert.equal(active.threadId, 'thread-rebuilt')
  assert.equal(active.turnId, 'turn-rebuilt')
  assert.deepEqual(requests.map(request => request.method), [
    'thread/fork',
    'thread/start',
    'thread/inject_items',
    'turn/start',
  ])
  assert.equal(requests[0]?.params.threadId, 'thread-a')
  assert.equal(requests[0]?.params.lastTurnId, 'turn-a')
  assert.deepEqual(requests[1]?.params.dynamicTools, [])
  assert.deepEqual(requests[2]?.params, {
    threadId: 'thread-rebuilt',
    items: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'first question' }],
      },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'first answer', annotations: [] }],
      },
    ],
  })
  assert.deepEqual(requests[3]?.params, {
    threadId: 'thread-rebuilt',
    input: [{ type: 'text', text: 'second question', text_elements: [] }],
    model: 'gpt-5.6-sol',
  })

  await adapter.dispose()
  assert.equal(closeCalls, 1)
})

test('unrelated thread/fork errors remain fail-closed and are not rebuilt', async () => {
  const requests: string[] = []
  let closeCalls = 0
  const connection = {
    async initialize() {},
    async request(method: string) {
      requests.push(method)
      if (method === 'thread/fork') {
        throw new JsonRpcResponseError(-32600, 'sandbox override is invalid')
      }
      throw new Error(`unexpected request ${method}`)
    },
    interrupt() {},
    async close() { closeCalls += 1 },
  }

  const adapter = new CodexAppServerAdapter({ attachments: {} } as any, config)
  ;(adapter as any).openConnection = async () => connection
  ;(adapter as any).isolationConfig = async () => ({ isolated: true })

  await assert.rejects(
    (adapter as any).startTurn({
      provider: 'codex-app-server',
      model: 'gpt-5.6-sol',
      messages: messages(),
    }, 'session-a', '/workspace'),
    /sandbox override is invalid/,
  )
  assert.deepEqual(requests, ['thread/fork'])
  assert.equal(closeCalls, 1)
})
