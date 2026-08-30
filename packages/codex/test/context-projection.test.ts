import assert from 'node:assert/strict'
import test from 'node:test'
import { projectedContentText } from '../src/codex-plugin-dsh/content-projection.ts'
import { prepareCodexHistory } from '../src/codex-plugin-dsh/history.ts'
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
  const history = await prepareCodexHistory(
    [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] },
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
              sessionId: 'session-a',
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

  // The results are this turn's input, prefixed by the line that says why.
  assert.deepEqual(history.turnInput, [
    {
      type: 'text',
      text: '[dsh: this turn continues from tool results produced outside the Codex thread]',
      text_elements: [],
    },
    { type: 'text', text: '[dsh: tool result for call_a]\nstarted', text_elements: [] },
  ])
  // They also stay in the imported history, paired with the call that made them.
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

  assert.deepEqual(history.turnInput.slice(1), [
    { type: 'text', text: '[dsh: tool result for call_a]\nstarted a', text_elements: [] },
    { type: 'text', text: '[dsh: tool result for call_b]\nstarted b', text_elements: [] },
  ])
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
