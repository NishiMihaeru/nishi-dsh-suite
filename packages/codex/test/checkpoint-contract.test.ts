import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message } from '@deepseek-ai/dsh-llm'
import { codexHistoryDigest, prepareCodexHistory } from '../src/codex-plugin-dsh/history.ts'

const provider = 'codex-app-server'
const noImages = async (): Promise<string> => {
  throw new Error('image resolution must not be reached')
}

// 1. a v1 checkpoint is passed over, skippedCheckpoints counts it, and the conversation rebuilds;
test('a v1 checkpoint is passed over, skippedCheckpoints counts it, and the conversation rebuilds', async () => {
  const u1: Message = {
    id: 'u-1',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'hello' }],
  }
  const a1: Message = {
    id: 'a-1',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 1,
          threadId: 'thread-v1',
          turnId: 'turn-v1',
          sessionId: 'session-a',
          toolSignature: 'tools-old',
        },
      },
    },
    content: [{ type: 'text', text: 'world' }],
  }
  const u2: Message = {
    id: 'u-2',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'next turn' }],
  }

  const history = await prepareCodexHistory([u1, a1, u2], provider, noImages, 'session-a')

  assert.equal(history.checkpoint, undefined)
  assert.equal(history.skippedCheckpoints, 1)
  assert.equal(history.injectItems.length, 2)
  assert.deepEqual(history.injectItems[0], {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'hello' }],
  })
  assert.deepEqual(history.injectItems[1], {
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'world', annotations: [] }],
  })
  assert.deepEqual(history.turnInput, [
    { type: 'text', text: 'next turn', text_elements: [] },
  ])
})

// 2. rewriting the content of a message before the checkpoint, keeping its id,
// causes the checkpoint to be refused and counted — this is the test that would have failed before this change;
test('rewriting the content of a message before the checkpoint, keeping its id, causes the checkpoint to be refused and counted', async () => {
  const originalUser: Message = {
    id: 'msg-user-1',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'original prompt before tool pruning' }],
  }
  const digest = codexHistoryDigest([originalUser])
  const assistant: Message = {
    id: 'msg-assistant-1',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 2,
          threadId: 'thread-2',
          turnId: 'turn-2',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: digest,
        },
      },
    },
    content: [{ type: 'text', text: 'assistant response' }],
  }
  const rewrittenUser: Message = {
    id: 'msg-user-1',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'pruned prompt with same id' }],
  }
  const currentTurn: Message = {
    id: 'msg-user-2',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'current question' }],
  }

  const history = await prepareCodexHistory([rewrittenUser, assistant, currentTurn], provider, noImages, 'session-a')

  assert.equal(history.checkpoint, undefined)
  assert.equal(history.skippedCheckpoints, 1)
  assert.equal(history.injectItems.length, 2)
  const injectedUser = history.injectItems[0] as any
  assert.equal(injectedUser.role, 'user')
  assert.deepEqual(injectedUser.content, [{ type: 'input_text', text: 'pruned prompt with same id' }])
})

// 3. reordering nothing and changing nothing leaves the checkpoint accepted;
test('reordering nothing and changing nothing leaves the checkpoint accepted', async () => {
  const user: Message = {
    id: 'msg-user-1',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'original prompt' }],
  }
  const digest = codexHistoryDigest([user])
  const assistant: Message = {
    id: 'msg-assistant-1',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 2,
          threadId: 'thread-accepted',
          turnId: 'turn-accepted',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: digest,
        },
      },
    },
    content: [{ type: 'text', text: 'assistant response' }],
  }
  const currentTurn: Message = {
    id: 'msg-user-2',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'current question' }],
  }

  const history = await prepareCodexHistory([user, assistant, currentTurn], provider, noImages, 'session-a')

  assert.equal(history.checkpoint?.turnId, 'turn-accepted')
  assert.equal(history.checkpoint?.threadId, 'thread-accepted')
  assert.equal(history.skippedCheckpoints, 0)
  assert.deepEqual(history.injectItems, [])
  assert.deepEqual(history.turnInput, [{ type: 'text', text: 'current question', text_elements: [] }])
})

// 4. a prefixLength that disagrees with the checkpoint's index is refused even when the digest of that many messages would match;
test('a prefixLength that disagrees with the checkpoint index is refused even when the digest of that many messages would match', async () => {
  const u1: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] }
  const u2: Message = { id: 'u-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] }
  // Checkpoint is at index 2, but sets prefixLength: 1 and prefixDigest of slice(0, 1)
  const assistant: Message = {
    id: 'a-1',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 2,
          threadId: 'thread-mismatched-len',
          turnId: 'turn-mismatched-len',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u1]),
        },
      },
    },
    content: [{ type: 'text', text: 'reply' }],
  }
  const currentTurn: Message = { id: 'u-3', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'third' }] }

  const history = await prepareCodexHistory([u1, u2, assistant, currentTurn], provider, noImages, 'session-a')

  assert.equal(history.checkpoint, undefined)
  assert.equal(history.skippedCheckpoints, 1)
})

// 5. when a rewrite happens after an older checkpoint, the scan falls back to that older checkpoint rather than rebuilding, and the messages after it are injected;
test('when a rewrite happens after an older checkpoint, the scan falls back to that older checkpoint and injects messages after it', async () => {
  const u0: Message = { id: 'u-0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q0' }] }
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
          threadId: 'thread-fallback',
          turnId: 'turn-older',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u0]),
        },
      },
    },
    content: [{ type: 'text', text: 'a0' }],
  }
  const u1Original: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q1 original' }] }
  const a1OriginalPrefixDigest = codexHistoryDigest([u0, a0, u1Original])
  const a1: Message = {
    id: 'a-1',
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      replayState: {
        response: {
          kind: 'codex-app-server',
          version: 2,
          threadId: 'thread-fallback',
          turnId: 'turn-newer',
          sessionId: 'session-a',
          prefixLength: 3,
          prefixDigest: a1OriginalPrefixDigest,
        },
      },
    },
    content: [{ type: 'text', text: 'a1' }],
  }
  // u1 is rewritten after a0's checkpoint was taken!
  const u1Rewritten: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q1 rewritten' }] }
  const u2: Message = { id: 'u-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q2' }] }

  const history = await prepareCodexHistory([u0, a0, u1Rewritten, a1, u2], provider, noImages, 'session-a')

  assert.equal(history.checkpoint?.turnId, 'turn-older')
  assert.equal(history.skippedCheckpoints, 1)
  // Everything after turn-older (u1Rewritten, a1) must be injected
  assert.equal(history.injectItems.length, 2)
  assert.deepEqual(history.injectItems[0], {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'q1 rewritten' }],
  })
  assert.deepEqual(history.injectItems[1], {
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'a1', annotations: [] }],
  })
  assert.deepEqual(history.turnInput, [{ type: 'text', text: 'q2', text_elements: [] }])
})

// 6. the lookback: history whose checkpoint sits on an assistant tool-call message
// with the result following produces injectItems where each function_call_output is
// immediately preceded by a function_call with the same call_id — assert the pairing by walking the items, not by index;
test('the lookback: history whose checkpoint sits on an assistant tool-call message produces injectItems where each function_call_output is immediately preceded by a function_call with the same call_id', async () => {
  const u0: Message = { id: 'u-0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'call tool' }] }
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
          threadId: 'thread-lookback-1',
          turnId: 'turn-lookback-1',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u0]),
        },
      },
    },
    content: [
      { type: 'text', text: 'let me check that' },
      { type: 'tool-call', id: 'call-alpha', name: 'search_docs', arguments: '{"q":"codex"}' },
    ],
  }
  const toolResult: Message = {
    id: 'tool-msg-1',
    role: 'user',
    source: { kind: 'tool', callId: 'call-alpha' },
    content: [
      { type: 'tool-result', toolCallId: 'call-alpha', content: [{ type: 'text', text: 'found 3 results' }] },
    ],
  }
  const u1: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'what did you find?' }] }

  const history = await prepareCodexHistory([u0, a0, toolResult, u1], provider, noImages, 'session-a')

  assert.equal(history.checkpoint?.turnId, 'turn-lookback-1')
  assert.equal(history.skippedCheckpoints, 0)
  assert.ok(history.injectItems.length > 0)

  // Verify the assistant message's text is never emitted into injectItems
  assert.equal(JSON.stringify(history.injectItems).includes('let me check that'), false)

  let functionCallOutputsChecked = 0
  for (let i = 0; i < history.injectItems.length; i++) {
    const item = history.injectItems[i] as any
    if (item.type === 'function_call_output') {
      assert.ok(i > 0, 'function_call_output must not be the first item')
      const preceding = history.injectItems[i - 1] as any
      assert.equal(preceding.type, 'function_call')
      assert.equal(preceding.call_id, item.call_id)
      assert.equal(item.call_id, 'call-alpha')
      assert.equal(preceding.name, 'search_docs')
      assert.equal(preceding.arguments, '{"q":"codex"}')
      functionCallOutputsChecked++
    }
  }
  assert.equal(functionCallOutputsChecked, 1)
})

// 7. the same with two tool calls in one assistant message, preserving order;
test('the lookback with two tool calls in one assistant message preserves order', async () => {
  const u0: Message = { id: 'u-0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'call two tools' }] }
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
          threadId: 'thread-lookback-2',
          turnId: 'turn-lookback-2',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u0]),
        },
      },
    },
    content: [
      { type: 'tool-call', id: 'call-first', name: 'fn1', arguments: '{"a":1}' },
      { type: 'tool-call', id: 'call-second', name: 'fn2', arguments: '{"b":2}' },
    ],
  }
  const toolResult1: Message = {
    id: 'tool-res-1',
    role: 'user',
    source: { kind: 'tool', callId: 'call-first' },
    content: [
      { type: 'tool-result', toolCallId: 'call-first', content: [{ type: 'text', text: 'result 1' }] },
    ],
  }
  const toolResult2: Message = {
    id: 'tool-res-2',
    role: 'user',
    source: { kind: 'tool', callId: 'call-second' },
    content: [
      { type: 'tool-result', toolCallId: 'call-second', content: [{ type: 'text', text: 'result 2' }] },
    ],
  }
  const u1: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] }

  const history = await prepareCodexHistory([u0, a0, toolResult1, toolResult2, u1], provider, noImages, 'session-a')

  assert.equal(history.checkpoint?.turnId, 'turn-lookback-2')
  assert.equal(history.skippedCheckpoints, 0)

  const pairs: Array<{ call_id: string; function_call: any; function_call_output: any }> = []
  for (let i = 0; i < history.injectItems.length; i++) {
    const item = history.injectItems[i] as any
    if (item.type === 'function_call_output') {
      assert.ok(i > 0, 'function_call_output must not be the first item')
      const preceding = history.injectItems[i - 1] as any
      assert.equal(preceding.type, 'function_call')
      assert.equal(preceding.call_id, item.call_id)
      pairs.push({ call_id: item.call_id, function_call: preceding, function_call_output: item })
    }
  }

  assert.equal(pairs.length, 2)
  assert.equal(pairs[0]?.call_id, 'call-first')
  assert.equal(pairs[1]?.call_id, 'call-second')
  assert.equal(pairs[0]?.function_call.name, 'fn1')
  assert.equal(pairs[1]?.function_call.name, 'fn2')
})

// 8. an assistant checkpoint message with text and no tool calls contributes no function_call item.
test('an assistant checkpoint message with text and no tool calls contributes no function_call item', async () => {
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
          threadId: 'thread-no-tools',
          turnId: 'turn-no-tools',
          sessionId: 'session-a',
          prefixLength: 1,
          prefixDigest: codexHistoryDigest([u0]),
        },
      },
    },
    content: [
      { type: 'text', text: 'just plain text response' },
    ],
  }
  const u1: Message = { id: 'u-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'how are you?' }] }

  const history = await prepareCodexHistory([u0, a0, u1], provider, noImages, 'session-a')

  assert.equal(history.checkpoint?.turnId, 'turn-no-tools')
  assert.equal(history.skippedCheckpoints, 0)
  assert.deepEqual(history.injectItems, [])
  assert.ok(
    history.injectItems.every(item => item.type !== 'function_call'),
    'must not contribute any function_call item',
  )
})
