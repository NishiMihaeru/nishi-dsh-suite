import assert from 'node:assert/strict'
import test from 'node:test'
import { projectedContentText } from '../src/codex-plugin-dsh/content-projection.ts'
import { codexHistoryDigest, prepareCodexHistory } from '../src/codex-plugin-dsh/history.ts'
import { codexDynamicToolResult } from '../src/codex-plugin-dsh/tools.ts'
import { projectCodexPrimaryHistory } from '../src/primary-history.ts'

const provider = 'codex-app-server'
const noImages = async (): Promise<string> => {
  throw new Error('image resolution must not be reached')
}

/**
 * A subagent settlement notice quotes the interrupted child's terminal output
 * verbatim, so its `user` message carries the child's pending `tool-call`.
 */
function settlementNotice() {
  return {
    role: 'user',
    source: { kind: 'plugin', plugin: 'dsh-subagent', form: 'notice', summary: 'subagent stopped' },
    content: [
      { type: 'text', text: 'subagent "scout" was stopped before it finished' },
      { type: 'tool-call', id: 'call-child-1', name: 'read', arguments: '{"path":"/etc/hosts"}' },
    ],
  }
}

test('every block a notice can quote projects to text instead of failing the turn', () => {
  assert.equal(projectedContentText({ type: 'text', text: 'plain' } as any), 'plain')
  assert.equal(
    projectedContentText({ type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"/x"}' } as any),
    '[dsh: tool call read({"path":"/x"})]',
  )
  assert.equal(
    projectedContentText({ type: 'reasoning', text: 'thought' } as any),
    '[dsh: reasoning]\nthought',
  )
  assert.equal(
    projectedContentText({
      type: 'tool-result',
      toolCallId: 'c1',
      isError: true,
      content: [{ type: 'text', text: 'ENOENT' }, { type: 'image', attachment: {} }],
    } as any),
    '[dsh: failed tool result for c1]\nENOENT\n[dsh: image content]',
  )
  assert.equal(
    projectedContentText({ type: 'plugin-defined', payload: {} } as any),
    '[dsh: "plugin-defined" content]',
  )
})

test('a settlement notice waking the turn becomes projected turn input', async () => {
  const user = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }
  const history = await prepareCodexHistory(
    [
      user,
      {
        role: 'assistant',
        source: {
          kind: 'model',
          provider,
          replayState: {
            response: {
              kind: 'codex-app-server',
              version: 2,
              threadId: 'thread-a',
              turnId: 'turn-a',
              sessionId: 'session-a',
              prefixLength: 1,
              prefixDigest: codexHistoryDigest([user as any]),
            },
          },
        },
        content: [{ type: 'text', text: 'started the subagent' }],
      },
      settlementNotice(),
    ] as any,
    provider,
    noImages,
    'session-a',
  )

  assert.equal(history.checkpoint?.threadId, 'thread-a')
  assert.deepEqual(history.injectItems, [])
  assert.deepEqual(history.turnInput, [
    { type: 'text', text: 'subagent "scout" was stopped before it finished', text_elements: [] },
    { type: 'text', text: '[dsh: tool call read({"path":"/etc/hosts"})]', text_elements: [] },
  ])
})

test('a settlement notice already in history replays as projected text', async () => {
  const history = await prepareCodexHistory(
    [
      settlementNotice(),
      {
        role: 'assistant',
        source: { kind: 'model', provider, replayState: undefined },
        content: [{ type: 'tool-call', id: 'call-1', name: 'todo_write', arguments: '{}' }],
      },
      {
        role: 'user',
        source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] }],
      },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'что случилось?' }] },
    ] as any,
    provider,
    noImages,
  )

  assert.equal(history.checkpoint, undefined)
  assert.deepEqual(history.injectItems[0], {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'subagent "scout" was stopped before it finished' },
      { type: 'input_text', text: '[dsh: tool call read({"path":"/etc/hosts"})]' },
    ],
  })
  assert.deepEqual(history.turnInput, [
    { type: 'text', text: 'что случилось?', text_elements: [] },
  ])
})

test('a settlement notice landing after a tool result steers projected text into the live turn', async () => {
  const continuation = await codexDynamicToolResult(
    [
      {
        role: 'assistant',
        source: { kind: 'model', provider },
        content: [{ type: 'tool-call', id: 'exec-1', name: 'todo_write', arguments: '{}' }],
      },
      {
        role: 'user',
        source: { kind: 'tool', callId: 'exec-1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'exec-1',
          content: [
            { type: 'text', text: 'todo updated' },
            { type: 'reasoning', text: 'nested' },
          ],
        }],
      },
      settlementNotice(),
    ] as any,
    'exec-1',
    noImages,
  )

  assert.deepEqual(continuation.response, {
    contentItems: [
      { type: 'inputText', text: 'todo updated' },
      { type: 'inputText', text: '[dsh: reasoning]\nnested' },
    ],
    success: true,
  })
  assert.deepEqual(continuation.steerInput, [
    { type: 'text', text: 'subagent "scout" was stopped before it finished', text_elements: [] },
    { type: 'text', text: '[dsh: tool call read({"path":"/etc/hosts"})]', text_elements: [] },
  ])
})

test('the primary bridge projects context blocks and leaves tool results alone', () => {
  const messages = [
    settlementNotice(),
    {
      id: 'm2',
      role: 'user',
      source: { kind: 'tool', callId: 'call-1' },
      content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] }],
    },
  ] as any

  const projected = projectCodexPrimaryHistory({ provider, model: 'gpt-5', messages } as any)

  assert.deepEqual(projected.messages[0]?.content, [
    { type: 'text', text: 'subagent "scout" was stopped before it finished' },
    { type: 'text', text: '[dsh: tool call read({"path":"/etc/hosts"})]' },
  ])
  assert.equal(projected.messages[1], messages[1])
})

test('the primary bridge leaves a text-and-image context request untouched', () => {
  const options = {
    provider,
    model: 'gpt-5',
    messages: [{
      id: 'm1',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'look' }, { type: 'image', attachment: {} }],
    }],
  } as any

  assert.equal(projectCodexPrimaryHistory(options), options)
})

/** One assistant tool call and its result, as another primary route left them. */
function toolCallAndResult(callId: string, from: string) {
  return [
    {
      role: 'assistant',
      source: { kind: 'model', provider: from },
      content: [{ type: 'tool-call', id: callId, name: 'subagent', arguments: '{"description":"scout"}' }],
    },
    {
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'started' }] }],
    },
  ]
}

test('a turn holding only tool results continues from them instead of failing', async () => {
  const history = await prepareCodexHistory(
    [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'delegate this' }] },
      ...toolCallAndResult('call_a', 'antigravity-cli'),
    ] as any,
    provider,
    noImages,
    'session-a',
  )

  // The turn input is the notice alone. The results are NOT repeated here:
  // they reach the model through the imported history, which
  // `test:live:inject-items` confirmed the model actually reads.
  assert.deepEqual(history.turnInput, [
    {
      type: 'text',
      text: '[dsh: this turn continues from tool results produced outside the Codex thread]',
      text_elements: [],
    },
  ])
  // The results live in the imported history, paired with the call that made
  // them -- which is now the single path by which the model sees them.
  assert.deepEqual(history.injectItems.slice(-2), [
    {
      type: 'function_call',
      call_id: 'call_a',
      name: 'subagent',
      arguments: '{"description":"scout"}',
      status: 'completed',
    },
    { type: 'function_call_output', call_id: 'call_a', output: 'started' },
  ])
})

/**
 * The live repro: one step on another route emitted two parallel `subagent`
 * calls, and the step that consumed their results resolved on Codex.
 */
test('two parallel tool results from one assistant message both reach the continued turn', async () => {
  const history = await prepareCodexHistory(
    [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'delegate twice' }] },
      {
        role: 'assistant',
        source: { kind: 'model', provider: 'antigravity-cli' },
        content: [
          { type: 'tool-call', id: 'call_a', name: 'subagent', arguments: '{"description":"a"}' },
          { type: 'tool-call', id: 'call_b', name: 'subagent', arguments: '{"description":"b"}' },
        ],
      },
      {
        role: 'user',
        source: { kind: 'tool', callId: 'call_a' },
        content: [{ type: 'tool-result', toolCallId: 'call_a', content: [{ type: 'text', text: 'started a' }] }],
      },
      {
        role: 'user',
        source: { kind: 'tool', callId: 'call_b' },
        content: [{ type: 'tool-result', toolCallId: 'call_b', content: [{ type: 'text', text: 'started b' }] }],
      },
    ] as any,
    provider,
    noImages,
  )

  // Both results reach the model, and exactly once each: the turn input is the
  // notice and nothing more, so the imported history is the only carrier.
  assert.equal(history.turnInput.length, 1)
  assert.equal(
    history.injectItems.filter(item => item.type === 'function_call_output').length,
    2,
    'both results must reach the imported history',
  )
})

test('a request with neither input nor tool results still fails loud', async () => {
  await assert.rejects(
    prepareCodexHistory(
      [{
        role: 'assistant',
        source: { kind: 'model', provider: 'antigravity-cli' },
        content: [{ type: 'text', text: 'done' }],
      }] as any,
      provider,
      noImages,
    ),
    /the current Codex turn has no user input/,
  )
})

/** A prior Codex response, with or without a usable checkpoint. */
function codexReply(
  text: string,
  checkpoint?: {
    threadId: string
    turnId: string
    sessionId: string
    prefixLength?: number
    prefixDigest?: string
  },
) {
  return {
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      ...checkpoint === undefined
        ? {}
        : {
            replayState: {
              response: {
                kind: 'codex-app-server',
                version: 2,
                ...checkpoint,
              },
            },
          },
    },
    content: [{ type: 'text', text }],
  }
}

const userSays = (text: string) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })

test('a Codex response with no usable checkpoint is passed over, not fatal', async () => {
  // It used to throw `a prior Codex response has no compatible App Server
  // checkpoint; start a new session`, which killed the session for good over
  // something this module can already recover from. The maintainer chose the
  // rebuild on 2026-08-31.
  const q1 = userSays('first question')
  const history = await prepareCodexHistory(
    [
      q1,
      codexReply('first answer', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        sessionId: 'session-a',
        prefixLength: 1,
        prefixDigest: codexHistoryDigest([q1 as any]),
      }),
      userSays('second question'),
      codexReply('second answer'),
      userSays('third question'),
    ] as any,
    provider,
    noImages,
    'session-a',
  )

  // The older usable checkpoint is resumed rather than the whole conversation
  // rebuilt: that is what keeps the vendor's prompt cache.
  assert.equal(history.checkpoint?.turnId, 'turn-1')
  assert.equal(history.skippedCheckpoints, 1)
  // Everything after that checkpoint is imported, the checkpoint-less reply
  // included, so the model still sees it.
  const injected = JSON.stringify(history.injectItems)
  assert.ok(injected.includes('second question'))
  assert.ok(injected.includes('second answer'))
  assert.deepEqual(history.turnInput, [{ type: 'text', text: 'third question', text_elements: [] }])
})

test('a history with no usable checkpoint at all rebuilds the whole conversation', async () => {
  const history = await prepareCodexHistory(
    [userSays('question'), codexReply('answer'), userSays('follow-up')] as any,
    provider,
    noImages,
    'session-a',
  )
  assert.equal(history.checkpoint, undefined)
  assert.equal(history.skippedCheckpoints, 1)
  const injected = JSON.stringify(history.injectItems)
  assert.ok(injected.includes('question') && injected.includes('answer'))
  assert.deepEqual(history.turnInput, [{ type: 'text', text: 'follow-up', text_elements: [] }])
})

test('a checkpoint from another DSH session is passed over and counted', async () => {
  const q = userSays('question')
  const history = await prepareCodexHistory(
    [
      q,
      codexReply('answer', {
        threadId: 'thread-x',
        turnId: 'turn-x',
        sessionId: 'session-OTHER',
        prefixLength: 1,
        prefixDigest: codexHistoryDigest([q as any]),
      }),
      userSays('follow-up'),
    ] as any,
    provider,
    noImages,
    'session-a',
  )
  assert.equal(history.checkpoint, undefined, 'another session\'s checkpoint must never be resumed')
  assert.equal(history.skippedCheckpoints, 1)
})

test('a response holding only tool calls without a checkpoint is counted as a lost checkpoint', async () => {
  // Under the stepped transport, every completed turn has a checkpoint of its
  // own -- including turns that produced tool calls -- so a response without
  // one is counted as skipped.
  const history = await prepareCodexHistory(
    [
      userSays('do the thing'),
      {
        role: 'assistant',
        source: { kind: 'model', provider },
        content: [{ type: 'tool-call', id: 'call_z', name: 'subagent', arguments: '{}' }],
      },
      { role: 'user', source: { kind: 'tool', callId: 'call_z' }, content: [{ type: 'tool-result', toolCallId: 'call_z', content: [{ type: 'text', text: 'done' }] }] },
      userSays('and now?'),
    ] as any,
    provider,
    noImages,
    'session-a',
  )
  assert.equal(history.skippedCheckpoints, 1)
})
