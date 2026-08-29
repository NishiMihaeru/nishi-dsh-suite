import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  CodexSearchBackend,
  CodexWebSearchBackendError,
  codexSearchExecArgv,
  codexSearchExecInvocation,
  codexSearchQueryLiteral,
  codexSearchResultFromEvents,
} from '../src/web-search-backend.ts'
import { PrimaryWebSearchError } from '../../core/src/web-search/errors.ts'
import { dispatchPrimarySearch } from '../../core/src/web-search/providers.ts'
import { codexAppServerInvocation } from '../src/codex-plugin-dsh/adapter.ts'

/** Preflight (app-server) managed child: JSON-RPC-driven, responds to `initialize`. */
function preflightChild(version = '0.150.0') {
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
          result: { userAgent: `codex-plugin-dsh/${version} (Linux; x86_64) codex-cli` },
        })}\n`)
      }
    }
  })
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  let settled = false
  return {
    pid: 5000,
    stdin,
    stdout,
    stderr: undefined,
    collected: { stderr: { readFrom() { return { text: '' } } } },
    done: done.promise,
    terminate() {
      if (settled) return
      settled = true
      done.resolve({ exitCode: 0, signal: null })
    },
    async waitForExit() { await done.promise; return true },
  }
}

/** Exec-search managed child that exits on its own, without emitting any terminal JSONL event. */
function silentlyExitingSearchChild(stderrText: string, exitCode = 1) {
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => {
    stdout.end()
    done.resolve({ exitCode, signal: null })
  })
  return {
    pid: 5001,
    stdin: undefined,
    stdout,
    stderr: undefined,
    collected: { stderr: { readFrom() { return { text: stderrText } } } },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

function fakeSearchCtx(stderrText: string) {
  return {
    subprocess: {
      async resolveExecutable() { return '/resolved/codex' },
      spawn(spec: any) {
        if (spec.stdio.stdin === 'pipe') return preflightChild()
        return silentlyExitingSearchChild(stderrText)
      },
    },
  } as any
}

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

test('Codex web search never forwards raw vendor stderr when the process exits before a terminal event', async () => {
  const SENTINEL_STDERR = 'unexpected failure while reading /home/testuser/.codex/auth.json SENTINEL_LEAK_MARKER'
  const ctx = fakeSearchCtx(SENTINEL_STDERR)

  await assert.rejects(
    new CodexSearchBackend(ctx, { executable: 'codex' }).search(
      { provider: 'codex-app-server', model: 'gpt-5.6-sol' },
      { query: 'example', maxResults: 3 },
      AbortSignal.timeout(5_000),
    ),
    (error: unknown) => {
      assert.ok(error instanceof CodexWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR', 'the WEB_SEARCH_PROVIDER_ERROR taxonomy must survive sanitization')
      assert.doesNotMatch(error.message, /SENTINEL_LEAK_MARKER/)
      assert.doesNotMatch(error.message, /auth\.json/)
      assert.doesNotMatch(error.message, /testuser/)
      return true
    },
  )
})

test('a recognized Codex stderr condition reports only its own authored message', async () => {
  const LOGIN_STDERR = 'fatal: you are not logged in. Run `codex login` and try again. (session at /home/testuser/.codex)'
  const ctx = fakeSearchCtx(LOGIN_STDERR)

  await assert.rejects(
    new CodexSearchBackend(ctx, { executable: 'codex' }).search(
      { provider: 'codex-app-server', model: 'gpt-5.6-sol' },
      { query: 'example', maxResults: 3 },
      AbortSignal.timeout(5_000),
    ),
    (error: unknown) => {
      assert.ok(error instanceof CodexWebSearchBackendError)
      assert.match(error.message, /sign-in is required/)
      assert.match(error.message, /codex login/)
      assert.doesNotMatch(error.message, /testuser/)
      return true
    },
  )
})

test('a sanitized Codex web_search failure survives core routing without leaking the raw marker', async () => {
  const SENTINEL_STDERR = '/home/testuser/.codex/auth.json SENTINEL_LEAK_MARKER'
  const ctx = fakeSearchCtx(SENTINEL_STDERR)
  const backend = new CodexSearchBackend(ctx, { executable: 'codex' })

  await assert.rejects(
    dispatchPrimarySearch(
      { provider: 'codex-app-server', model: 'gpt-5.6-sol' },
      { query: 'example', maxResults: 3 },
      AbortSignal.timeout(5_000),
      () => backend,
    ),
    (error: unknown) => {
      assert.ok(error instanceof PrimaryWebSearchError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR')
      assert.doesNotMatch(error.message, /SENTINEL_LEAK_MARKER/)
      assert.doesNotMatch(error.message, /auth\.json/)
      assert.doesNotMatch(error.message, /testuser/)
      return true
    },
  )
})

test('concurrent runtime preflights share one in-flight spawn, and a failed preflight is retried, never cached as success', async () => {
  // Drives the backend's private preflight cache directly (mirroring
  // packages/codex/test/model-catalog-race.test.ts's `subject.models()`
  // pattern) rather than through the full public search(), which would
  // additionally race each call's own per-call mkdtemp() against the
  // preflight's completion and make the spawn count non-deterministic.
  let preflightSpawns = 0
  let preflightShouldFail = true

  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/codex' },
      spawn() {
        preflightSpawns += 1
        if (preflightShouldFail) {
          // A preflight whose stdout closes without ever answering `initialize`.
          const stdout = new PassThrough()
          const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
          queueMicrotask(() => { stdout.end(); done.resolve({ exitCode: 1, signal: null }) })
          return {
            pid: 6000 + preflightSpawns,
            stdin: new PassThrough(),
            stdout,
            stderr: undefined,
            collected: { stderr: { readFrom() { return { text: '' } } } },
            done: done.promise,
            terminate() {},
            async waitForExit() { await done.promise; return true },
          }
        }
        return preflightChild()
      },
    },
  } as any

  const backend = new CodexSearchBackend(ctx, { executable: 'codex' }) as any

  // Three concurrent callers while the preflight is set up to fail.
  const firstRound = await Promise.allSettled([
    backend.ensureVerifiedRuntime('/resolved/codex', AbortSignal.timeout(5_000)),
    backend.ensureVerifiedRuntime('/resolved/codex', AbortSignal.timeout(5_000)),
    backend.ensureVerifiedRuntime('/resolved/codex', AbortSignal.timeout(5_000)),
  ])
  assert.ok(firstRound.every(settled => settled.status === 'rejected'), 'a failed preflight must fail every concurrent caller')
  assert.equal(preflightSpawns, 1, 'concurrent callers must share exactly one in-flight preflight spawn')

  // The next call must retry rather than trust a cached failure.
  preflightShouldFail = false
  await backend.ensureVerifiedRuntime('/resolved/codex', AbortSignal.timeout(5_000))
  assert.equal(preflightSpawns, 2, 'a failed preflight must not be cached as success; the next call retries it')

  // Once verified, a further call for the same executable spawns nothing more.
  await backend.ensureVerifiedRuntime('/resolved/codex', AbortSignal.timeout(5_000))
  assert.equal(preflightSpawns, 2, 'a verified executable is cached and does not re-run the preflight')
})

test('argv contract: codex exec routes through the same Windows batch shim as app-server', () => {
  const executable = 'C:\\Users\\user\\AppData\\Roaming\\npm\\codex.cmd'
  const prompt = 'search prompt with "quotes", & ampersands, and % percents'
  const spec = {
    executable,
    model: 'gpt-5.6-sol',
    cwd: 'C:\\work',
    schemaPath: 'C:\\work\\schema.json',
    prompt,
  }

  const posix = codexSearchExecInvocation(spec, {}, 'linux')
  assert.deepEqual(posix.argv, codexSearchExecArgv(spec), 'non-Windows platforms are unaffected')

  const { argv, env } = codexSearchExecInvocation(spec, {}, 'win32', 'cmd.exe')

  assert.equal(argv[0], 'cmd.exe', 'the same interpreter as the app-server invocation must front the command')
  assert.deepEqual(argv.slice(1, 5), ['/d', '/v:off', '/s', '/c'], 'the same suppression flags as the app-server invocation')
  assert.equal(argv.includes(executable), false, 'the configured executable path must never enter the parsed command tail')
  assert.equal(argv.includes(prompt), false, 'the model-authored prompt must never enter the parsed command tail directly')

  const promptOccurrences = argv.filter(arg => arg.includes('%') && arg.toLowerCase().includes('prompt'))
  assert.equal(promptOccurrences.length, 1, 'the prompt placeholder must appear exactly once, as one argv element')
  assert.equal(argv[argv.length - 1], promptOccurrences[0], 'the prompt placeholder is the last argv element, exactly one token')

  assert.ok(Object.values(env).some(value => value.includes(executable)), 'the executable path travels via the environment, not argv')
  assert.ok(Object.values(env).some(value => value === `"${prompt}"`), 'the prompt travels via the environment, not argv')

  const appServer = codexAppServerInvocation(executable, {}, 'win32', 'cmd.exe')
  assert.deepEqual(
    argv.slice(0, 6),
    appServer.argv.slice(0, 6),
    'codex exec must share the identical interpreter/flags/executable-placeholder prefix as the app-server invocation',
  )
})

test('a simultaneous operation failure and subprocess cleanup failure preserve the original diagnostic', async () => {
  const OPERATION_MARKER = 'search-operation-failed-marker'
  const CLEANUP_MARKER = 'cleanup-failed-marker'

  // A structured protocol `error` event (not raw stderr) so the operation
  // failure carries an identifiable, traceable marker unaffected by the
  // stderr-sanitization contract this suite covers elsewhere.
  function failingOperationSearchChild() {
    const stdout = new PassThrough()
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    queueMicrotask(() => {
      stdout.end(`${JSON.stringify({ type: 'error', message: OPERATION_MARKER })}\n`)
      done.resolve({ exitCode: 1, signal: null })
    })
    return {
      pid: 5002,
      stdin: undefined,
      stdout,
      stderr: undefined,
      collected: { stderr: { readFrom() { return { text: '' } } } },
      done: done.promise,
      terminate() {},
      // Cleanup (disposeVendorChild -> child.waitForExit()) fails too.
      async waitForExit() { throw new Error(CLEANUP_MARKER) },
    }
  }

  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/codex' },
      spawn(spec: any) {
        if (spec.stdio.stdin === 'pipe') return preflightChild()
        return failingOperationSearchChild()
      },
    },
  } as any

  const backend = new CodexSearchBackend(ctx, { executable: 'codex' })

  await assert.rejects(
    backend.search(
      { provider: 'codex-app-server', model: 'gpt-5.6-sol' },
      { query: 'example', maxResults: 1 },
      AbortSignal.timeout(5_000),
    ),
    (error: unknown) => {
      assert.ok(error instanceof CodexWebSearchBackendError)
      assert.equal(error.code, 'WEB_SEARCH_PROVIDER_ERROR', 'the operation failure taxonomy code must survive')
      assert.match(error.message, new RegExp(OPERATION_MARKER))
      assert.match(error.message, new RegExp(CLEANUP_MARKER))
      assert.ok(error.cause instanceof AggregateError, 'both failures must be reachable, e.g. via AggregateError')
      const aggregate = error.cause as AggregateError
      assert.equal(aggregate.errors.length, 2)
      const [operationError, cleanupError] = aggregate.errors as [Error, Error]
      assert.match(String(operationError?.message), new RegExp(OPERATION_MARKER))
      assert.match(String(cleanupError?.message), new RegExp(CLEANUP_MARKER))
      return true
    },
  )
})
