import assert from 'node:assert/strict'
import test from 'node:test'
import {
  codexSearchExecArgv,
  codexSearchResultFromEvents,
} from '../src/web-search-backend.ts'

test('Codex web search uses external codex exec with live native search and structured output', () => {
  const argv = codexSearchExecArgv({
    executable: '/home/user/.local/bin/codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    cwd: '/tmp/search-workdir',
    schemaPath: '/tmp/search-workdir/search-output.schema.json',
    prompt: 'search prompt',
  })

  assert.deepEqual(argv, [
    '/home/user/.local/bin/codex',
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--cd', '/tmp/search-workdir',
    '--json',
    '--output-schema', '/tmp/search-workdir/search-output.schema.json',
    '-m', 'gpt-5.6-sol',
    '-c', 'model_reasoning_effort="high"',
    '-c', 'web_search="live"',
    'search prompt',
  ])
})

test('Codex web search omits reasoning override when the route effort is unsupported', () => {
  const argv = codexSearchExecArgv({
    executable: '/usr/bin/codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'unknown',
    cwd: '/tmp/search-workdir',
    schemaPath: '/tmp/search-workdir/schema.json',
    prompt: 'search prompt',
  })

  assert.equal(argv.some((arg) => arg.startsWith('model_reasoning_effort=')), false)
  assert.ok(argv.includes('web_search="live"'))
})

test('Codex web search accepts only a completed native web_search plus structured agent message', () => {
  const result = codexSearchResultFromEvents([
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'search-1', type: 'web_search', query: 'example' } },
    {
      type: 'item.completed',
      item: {
        id: 'answer-1',
        type: 'agent_message',
        text: JSON.stringify({
          content: 'summary',
          sources: [{ url: 'https://example.com', title: 'Example', snippet: 'Snippet', publishedAt: '' }],
        }),
      },
    },
    { type: 'turn.completed', usage: {} },
  ])

  assert.deepEqual(result, {
    content: 'summary',
    sources: [{ url: 'https://example.com', title: 'Example', snippet: 'Snippet', publishedAt: '' }],
  })
})

test('Codex web search rejects completion without native web_search', () => {
  assert.throws(
    () => codexSearchResultFromEvents([
      { type: 'item.completed', item: { id: 'answer-1', type: 'agent_message', text: '{"content":"x","sources":[]}' } },
      { type: 'turn.completed', usage: {} },
    ]),
    /without a native web_search item/,
  )
})

test('Codex web search rejects unexpected local tool activity', () => {
  assert.throws(
    () => codexSearchResultFromEvents([
      { type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'cat file', status: 'completed' } },
      { type: 'item.completed', item: { id: 'search-1', type: 'web_search', query: 'example' } },
      { type: 'item.completed', item: { id: 'answer-1', type: 'agent_message', text: '{"content":"x","sources":[]}' } },
      { type: 'turn.completed', usage: {} },
    ]),
    /unexpected local tool item command_execution/,
  )
})
