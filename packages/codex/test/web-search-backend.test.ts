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
    '-c', 'features.memories=false',
    '-c', 'features.external_agent_memory_import=false',
    '-c', 'features.chronicle=false',
    '-c', 'features.view_image=false',
    '-c', 'features.hooks=false',
    '-c', 'features.goals=false',
    '-c', 'features.token_budget=false',
    '-c', 'features.rollout_budget=false',
    '-c', 'features.current_time_reminder=false',
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
    { type: 'item.completed', item: { id: 'reason-1', type: 'reasoning', text: 'thinking' } },
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

test('Codex web search rejects every unexpected completed host item', () => {
  assert.throws(
    () => codexSearchResultFromEvents([
      { type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'cat file', status: 'completed' } },
      { type: 'item.completed', item: { id: 'search-1', type: 'web_search', query: 'example' } },
      { type: 'item.completed', item: { id: 'answer-1', type: 'agent_message', text: '{"content":"x","sources":[]}' } },
      { type: 'turn.completed', usage: {} },
    ]),
    /unexpected completed item command_execution/,
  )
  assert.throws(
    () => codexSearchResultFromEvents([
      { type: 'item.completed', item: { id: 'image-1', type: 'image_generation' } },
      { type: 'turn.completed', usage: {} },
    ]),
    /unexpected completed item image_generation/,
  )
})

test('Codex web search verifies runtime, resolves and spawns with provider env, then proves both process trees exit', async () => {
  const searchStdout = new PassThrough()
  const providerEnv = {
    DSH_CODEX_EXECUTABLE: '/configured/codex',
    CODEX_HOME: '/configured/home',
    PATH: '/configured/bin',
  }
  const resolveCalls: any[] = []
  const spawned: any[] = []
  const waitSignals: Array<AbortSignal | undefined> = []
  let terminateCalls = 0

  function managedChild(stdin: PassThrough | undefined, stdout: PassThrough) {
    let settled = false
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    return {
      pid: 4242 + spawned.length,
      stdin,
      stdout,
      stderr: undefined,
      collected: { stderr: { readFrom() { return { text: '' } } } },
      done: done.promise,
      terminate() {
        terminateCalls += 1
        if (settled) return
        settled = true
        done.resolve({ exitCode: 0, signal: null })
      },
      async waitForExit(signal?: AbortSignal) {
        waitSignals.push(signal)
        await done.promise
        return true
      },
    }
  }

  const ctx = {
    subprocess: {
      async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal) {
        resolveCalls.push({ command, env, signal })
        return '/resolved/codex'
      },
      spawn(spec: any) {
        spawned.push(spec)
        if (spec.stdio.stdin === 'pipe') {
          const stdin = new PassThrough()
          const stdout = new PassThrough()
          let buffer = ''
          stdin.setEncoding('utf8')
          stdin.on('data', (chunk: string) => {
            buffer += chunk
            for (;;) {
              const newline = buffer.indexOf('\n')
              if (newline < 0) break
              const line = buffer.slice(0, newline).trim()
              buffer = buffer.slice(newline + 1)
              if (!line) continue
              const message = JSON.parse(line) as Record<string, unknown>
              if (message.method === 'initialize') {
                stdout.write(`${JSON.stringify({
                  jsonrpc: '2.0',
                  id: message.id,
                  result: {
                    userAgent: 'codex-plugin-dsh/0.150.0 (Linux; x86_64) codex-cli',
                    codexHome: '/configured/home',
                    platformFamily: 'unix',
                    platformOs: 'linux',
                  },
                })}\n`)
              }
            }
          })
          return managedChild(stdin, stdout)
        }

        queueMicrotask(() => {
          searchStdout.write(`${JSON.stringify({ type: 'item.completed', item: { id: 'search-1', type: 'web_search', query: 'example' } })}\n`)
          searchStdout.write(`${JSON.stringify({
            type: 'item.completed',
            item: { id: 'answer-1', type: 'agent_message', text: '{"content":"summary","sources":[]}' },
          })}\n`)
          searchStdout.end(`${JSON.stringify({ type: 'turn.completed', usage: {} })}\n`)
        })
        return managedChild(undefined, searchStdout)
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
  assert.equal(spawned.length, 2)
  assert.equal(spawned[0].stdio.stdin, 'pipe', 'first child is the audited App Server version preflight')
  assert.equal(spawned[1].stdio.stdin, 'ignore', 'second child is the isolated codex exec search')
  assert.equal(spawned[0].argv[0], '/resolved/codex')
  assert.equal(spawned[1].argv[0], '/resolved/codex')
  assert.deepEqual(spawned[0].env, providerEnv)
  assert.deepEqual(spawned[1].env, providerEnv)
  assert.equal(terminateCalls, 2)
  assert.deepEqual(waitSignals, [undefined, undefined])
})
