import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareCodexHistory } from '../src/codex-plugin-dsh/history.ts'

const provider = 'codex-app-server'
const noImages = async (): Promise<string> => {
  throw new Error('image resolution must not be reached')
}

function historyWithCheckpoint(sessionId: string) {
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
        provider,
        replayState: {
          response: {
            kind: 'codex-app-server',
            version: 1,
            threadId: 'thread-a',
            turnId: 'turn-a',
            sessionId,
            toolSignature: 'tools-a',
          },
        },
      },
      content: [
        { type: 'reasoning', text: 'private transient reasoning' },
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

test('matching DSH session may reuse the durable Codex App Server checkpoint', async () => {
  const history = await prepareCodexHistory(
    historyWithCheckpoint('session-a'),
    provider,
    noImages,
    'session-a',
  )

  assert.equal(history.checkpoint?.threadId, 'thread-a')
  assert.deepEqual(history.injectItems, [])
  assert.deepEqual(history.turnInput, [
    { type: 'text', text: 'second question', text_elements: [] },
  ])
})

test('foreign-session checkpoint is never reused and fallback omits non-importable reasoning', async () => {
  const history = await prepareCodexHistory(
    historyWithCheckpoint('session-a'),
    provider,
    noImages,
    'session-b',
  )

  assert.equal(history.checkpoint, undefined)
  assert.deepEqual(history.injectItems, [
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
  ])
  assert.deepEqual(history.turnInput, [
    { type: 'text', text: 'second question', text_elements: [] },
  ])
})

test('forced rebuild after a tool-catalog change can import prior Codex visible history', async () => {
  const history = await prepareCodexHistory(
    historyWithCheckpoint('session-a'),
    provider,
    noImages,
    'session-a',
    true,
  )

  assert.equal(history.checkpoint, undefined)
  assert.equal(history.injectItems.length, 2)
  const assistant = history.injectItems[1] as any
  assert.equal(assistant.role, 'assistant')
  assert.deepEqual(assistant.content, [
    { type: 'output_text', text: 'first answer', annotations: [] },
  ])
})
