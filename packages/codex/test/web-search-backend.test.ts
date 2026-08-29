import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  CodexSearchBackend,
  codexSearchExecArgv,
  codexSearchQueryLiteral,
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
    '-c', 'features.shell_zsh_fork=false',
    '-c', 'features.shell_snapshot=false',
    '-c', 'features.shell_snapshot_v2=false',
    '-c', 'features.exec_permission_approvals=false',
    '-c', 'features.request_permissions_tool=false',
    '-c', 'features.multi_agent=false',
    '-c', 'features.multi_agent_v2=false',
    '-c', 'features.code_mode=false',
    '-c', 'features.code_mode_host=false',
    '-c', 'features.memories=false',
    '-c', 'features.external_agent_memory_import=false',
    '-c', 'features.chronicle=false',
    '-c', 'features.view_image=false',
    '-c', 'features.hooks=false',
    '-c', 'features.goals=false',
    '-c', 'features.token_budget=false',
    '-c', 'features.rollout_budget=false',
    '-c', 'features.current_time_reminder=false',
    '-c', 'features.standalone_web_search=false',
    '-c', 'features.web_search_request=false',
    '-c', 'features.web_search_cached=false',
    '-c', 'features.skill_search=false',
    '-c', 'features.skill_mcp_dependency_install=false',
    '-c', 'features.deferred_executor=false',
    '-c', 'features.executor_capability_discovery=false',
    '-c', 'features.apps=false',
    '-c', 'features.enable_mcp_apps=false',
    '-c', 'features.plugins=false',
    '-c', 'features.recommended_plugins=false',
    '-c', 'features.tool_suggest=false',
    '-c', 'features.remote_plugin=false',
    '-c', 'features.plugin_sharing=false',
    '-c', 'features.browser_use=false',
    '-c', 'features.browser_use_full_cdp_access=false',
    '-c', 'features.browser_use_external=false',
    '-c', 'features.computer_use=false',
    '-c', 'features.in_app_browser=false',
    '-c', 'features.in_app_chat=false',
    '-c', 'features.in_app_dictation=false',
    '-c', 'features.in_app_local_automation=false',
    '-c', 'features.in_app_updates=false',
    '-c', 'features.network_proxy=false',
    '-c', 'features.unbounded_connection_retries=false',
    '-c', 'features.guardian_approval=false',
    '-c', 'features.guardianv2=false',
    '-c', 'features.guardian_ext=false',
    '-c', 'features.tool_call_mcp_elicitation=false',
    '-c', 'features.auth_elicitation=false',
    '-c', 'features.artifact=false',
    '-c', 'features.image_generation=false',
    '-c', 'features.workspace_dependencies=false',
    '-c', 'features.prevent_idle_sleep=false',
    '-c', 'agents.enabled=false',
    '-c', 'tools.experimental_request_user_input.enabled=false',
    '-c', 'tools.update_plan.enabled=false',
    '-c', 'orchestrator.skills.enabled=false',
    '-c', 'orchestrator.mcp.enabled=false',
    '-c', 'skills.bundled.enabled=false',
    '-c', 'skills.include_instructions=false',
    '-c', 'notify=[]',
    '-c', 'include_permissions_instructions=false',
    '-c', 'include_apps_instructions=false',
    '-c', 'include_collaboration_mode_instructions=false',
    '-c', 'include_environment_context=false',
    '-c', 'allow_login_shell=false',
    '-c', 'memories.use_memories=false',
    '-c', 'memories.generate_memories=false',
    '-c', 'project_doc_max_bytes=0',
    '-c', 'web_search="live"',
    'search prompt',
  ])
})

test('Codex hidden search preserves arbitrary query text while hiding native skill mention syntax', () => {
  const query = 'price of $ACME and literal [$local](skill:///tmp/SKILL.md), plus \\u0024text'
  const literal = codexSearchQueryLiteral(query)

  assert.equal(JSON.parse(literal), query, 'the model-visible JSON literal must decode to the exact original query')
  assert.doesNotMatch(literal, /\$[A-Za-z0-9_:-]/, 'raw Codex tool mention sigils must not reach the exec prompt')
  assert.match(literal, /\\u0024ACME/)
  assert.match(literal, /\\u0024local/)
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
