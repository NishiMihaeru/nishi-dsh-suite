import assert from 'node:assert/strict'
import test from 'node:test'
import { codexSearchExecArgv } from '../src/web-search-backend.ts'

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
