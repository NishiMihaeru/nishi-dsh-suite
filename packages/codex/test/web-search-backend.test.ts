import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  CodexSearchBackend,
  codexSearchExecArgv,
  codexSearchResultFromEvents,
} from '../src/web-search-backend.ts'

test('Codex web search uses external codex exec with live native search and pre-execution isolation', () => {
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
    '-c', 'approval_policy="never"',
    '-c', 'features.shell_tool=false',
    '-c', 'features.unified_exec=false',
    '-c', 'features.multi_agent=false',
    '-c', 'features.multi_agent_v2=false',
    '-c', 'features.code_mode=false',
    '-c', 'features.view_image=false',
    '-c', 'features.hooks=false',
    '-c', 'features.apps=false',
    '-c', 'features.plugins=false',
    '-c', 'agents.enabled=false',
    '-c', 'memories.use_memories=false',
    '-c', 'memories.generate_memories=false',
    '-c', 'project_doc_max_bytes=0',
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

test('Codex web search resolves and spawns with provider env, then proves process-tree exit', async () => {
  const stdout = new PassThrough()
  const providerEnv = {
    DSH_CODEX_EXECUTABLE: '/configured/codex',
    CODEX_HOME: '/configured/home',
    PATH: '/configured/bin',
  }
  const resolveCalls: any[] = []
  const spawned: any[] = []
  const waitSignals: Array<AbortSignal | undefined> = []
  let terminated = false
  let resolveDone!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveDone = resolve
  })

  const ctx = {
    subprocess: {
      async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal) {
        resolveCalls.push({ command, env, signal })
        return '/resolved/codex'
      },
      spawn(spec: any) {
        spawned.push(spec)
        queueMicrotask(() => {
          stdout.write(`${JSON.stringify({ type: 'item.completed', item: { id: 'search-1', type: 'web_search', query: 'example' } })}\n`)
          stdout.write(`${JSON.stringify({
            type: 'item.completed',
            item: { id: 'answer-1', type: 'agent_message', text: '{"content":"summary","sources":[]}' },
          })}\n`)
          stdout.end(`${JSON.stringify({ type: 'turn.completed', usage: {} })}\n`)
        })
        return {
          pid: 4242,
          stdin: undefined,
          stdout,
          stderr: undefined,
          collected: { stderr: { readFrom() { return { text: '' } } } },
          done,
          terminate() {
            if (terminated) return
            terminated = true
            resolveDone({ exitCode: 0, signal: null })
          },
          async waitForExit(signal?: AbortSignal) {
            waitSignals.push(signal)
            await done
            return true
          },
        }
      },
    },
  } as any
  const signal = AbortSignal.timeout(5_000)

  const result = await new CodexSearchBackend(ctx, {
    executable: providerEnv.DSH_CODEX_EXECUTABLE,
    env: providerEnv,
  }).search(
    { provider: 'codex-app-server', model: 'gpt-5.6-sol' },
    { query: 'example', maxResults: 5 },
    signal,
  )

  assert.deepEqual(result, { content: 'summary', sources: [] })
  assert.equal(resolveCalls.length, 1)
  assert.equal(resolveCalls[0].command, '/configured/codex')
  assert.deepEqual(resolveCalls[0].env, providerEnv)
  assert.equal(resolveCalls[0].signal, signal)
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].argv[0], '/resolved/codex')
  assert.deepEqual(spawned[0].env, providerEnv)
  assert.equal(spawned[0].stdio.stdin, 'ignore')
  assert.equal(terminated, true)
  assert.deepEqual(waitSignals, [undefined])
})
