import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { PrimaryWebSearchError } from '../../core/src/web-search/errors.ts'
import { dispatchPrimarySearch } from '../../core/src/web-search/providers.ts'
import { SEARCH_EFFORT, SEARCH_MODEL, SEARCH_TOOL_NAME } from '../src/grok-vendor.ts'
import {
  GrokSearchBackend,
  GrokWebSearchBackendError,
  grokSearchResultFromEvents,
  parseSearchStdout,
} from '../src/web-search-backend.ts'

const STRUCTURED = {
  content: 'The official Node.js website is https://nodejs.org/.',
  sources: [{
    url: 'https://nodejs.org/en/about',
    title: 'Node.js official website',
    snippet: 'The official Node.js website is https://nodejs.org/.',
    publishedAt: '',
  }],
}

/**
 * Shape recorded from `grok 1.0.13` / `grok-4.5` on 2026-09-04: a client
 * `web_search` tool_use, a `WebSearch` tool_result, and a schema-bound
 * `result`. `server_tool_use.web_search_requests` stayed 0 -- that counter
 * is backend-hosted search only and must not be treated as proof.
 */
const RECORDED_SEARCH_EVENTS = [
  { type: 'system', subtype: 'init', tools: ['search_tool', 'use_tool', 'web_search'] },
  {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'call_1', name: 'web_search', input: { query: 'Node.js official website' } }],
    },
  },
  {
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 'call_1',
        content: JSON.stringify({
          type: 'WebSearch',
          query: 'Node.js official website',
          content: 'The official Node.js website is https://nodejs.org/.',
          citations: ['https://nodejs.org/en/about'],
          allowed_domains: null,
        }),
        is_error: false,
      }],
    },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    usage: { server_tool_use: { web_search_requests: 0 } },
    modelUsage: { 'grok-4.5-build': { webSearchRequests: 0 } },
    structured_output: STRUCTURED,
  },
]

function searchChild(stdoutBody: string, stderrText = '', exitCode = 0) {
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => done.resolve({ exitCode, signal: null }))
  return {
    pid: 9201,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdoutBody } } },
      stderr: { readFrom() { return { text: stderrText } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

function hangingChild() {
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  return {
    pid: 9202,
    stdin: new PassThrough(),
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: '' } } },
      stderr: { readFrom() { return { text: '' } } },
    },
    done: done.promise,
    terminate() { done.resolve({ exitCode: null, signal: 'SIGTERM' }) },
    async waitForExit() { await done.promise; return true },
  }
}

function fakeCtx(child: ReturnType<typeof searchChild> | ReturnType<typeof hangingChild>) {
  const spawns: { argv: string[]; cwd: string }[] = []
  return {
    spawns,
    ctx: {
      subprocess: {
        async resolveExecutable(name: string) { return name },
        spawn(spec: { argv: readonly string[]; cwd: string; signal?: AbortSignal }) {
          spawns.push({ argv: [...spec.argv], cwd: spec.cwd })
          if (spec.signal?.aborted) child.terminate()
          else spec.signal?.addEventListener('abort', () => child.terminate(), { once: true })
          return child
        },
      },
    } as any,
  }
}

const backendConfig = {
  executable: 'grok',
  env: {},
  timeoutMs: 5_000,
  disposeGraceMs: 50,
  stderrMaxBytes: 4_096,
}

test('the recorded client-search stream yields structured output even when web_search_requests is 0', () => {
  assert.deepEqual(grokSearchResultFromEvents(RECORDED_SEARCH_EVENTS), STRUCTURED)
})

test('a Messages stream with no web_search fails closed', () => {
  assert.throws(
    () => grokSearchResultFromEvents([
      { type: 'system', subtype: 'init', tools: ['search_tool', 'use_tool', 'web_search'] },
      { type: 'result', subtype: 'success', is_error: false, structured_output: STRUCTURED },
    ]),
    (error: unknown) => error instanceof GrokWebSearchBackendError
      && error.code === 'WEB_SEARCH_PROTOCOL'
      && /without web_search/.test(error.message),
  )
})

test('an unexpected native tool on the hidden search turn fails closed', () => {
  assert.throws(
    () => grokSearchResultFromEvents([
      { type: 'system', subtype: 'init', tools: ['search_tool', 'use_tool', 'web_search'] },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'run_terminal_command', input: { command: 'ls' } }] },
      },
      { type: 'result', subtype: 'success', is_error: false, structured_output: STRUCTURED },
    ]),
    (error: unknown) => error instanceof GrokWebSearchBackendError
      && error.code === 'WEB_SEARCH_PROTOCOL'
      && /run_terminal_command/.test(error.message),
  )
})

test('init.tools advertising a built-in outside the search allowlist fails closed', () => {
  assert.throws(
    () => grokSearchResultFromEvents([
      { type: 'system', subtype: 'init', tools: ['search_tool', 'use_tool', 'web_search', 'run_terminal_command'] },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'web_search', input: { query: 'q' } }] },
      },
      { type: 'result', subtype: 'success', is_error: false, structured_output: STRUCTURED },
    ]),
    (error: unknown) => error instanceof GrokWebSearchBackendError
      && error.code === 'WEB_SEARCH_PROTOCOL'
      && /run_terminal_command/.test(error.message),
  )
})

test('a json envelope cannot prove client-side web_search', () => {
  assert.throws(
    () => grokSearchResultFromEvents([{
      text: JSON.stringify(STRUCTURED),
      stopReason: 'end_turn',
      structuredOutput: STRUCTURED,
      usage: { server_tool_use: { web_search_requests: 0 } },
    }]),
    (error: unknown) => error instanceof GrokWebSearchBackendError
      && error.code === 'WEB_SEARCH_PROTOCOL'
      && /json envelope/.test(error.message),
  )
})

test('inline backend search (server_tool_use) counts as native search', () => {
  assert.deepEqual(grokSearchResultFromEvents([
    { type: 'system', subtype: 'init', tools: ['search_tool', 'use_tool', 'web_search'] },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'server_tool_use', name: 'web_search', input: { query: 'q' } },
          { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://nodejs.org/', title: 'Node.js' }] },
        ],
      },
    },
    { type: 'result', subtype: 'success', is_error: false, structured_output: STRUCTURED },
  ]), STRUCTURED)
})

test('empty structured sources are filled from native WebSearch citations', () => {
  const events = RECORDED_SEARCH_EVENTS.map(event => {
    if (event.type !== 'result') return event
    return { ...event, structured_output: { content: STRUCTURED.content, sources: [] } }
  })
  assert.deepEqual(grokSearchResultFromEvents(events), {
    content: STRUCTURED.content,
    sources: [{ url: 'https://nodejs.org/en/about', title: '', snippet: '', publishedAt: '' }],
  })
})

test('parseSearchStdout reads NDJSON and skips blank lines', () => {
  const stdout = RECORDED_SEARCH_EVENTS.map(event => JSON.stringify(event)).join('\n')
  assert.deepEqual(parseSearchStdout(`\n${stdout}\n`), STRUCTURED)
})

test('GrokSearchBackend writes a prompt file, uses the search argv, and returns structured output', async () => {
  const stdout = RECORDED_SEARCH_EVENTS.map(event => JSON.stringify(event)).join('\n')
  const fixture = fakeCtx(searchChild(stdout))
  const raw = await new GrokSearchBackend(fixture.ctx, backendConfig).search(
    { provider: 'grok-cli', model: 'grok-4.6', reasoningEffort: 'xhigh' },
    { query: 'Node.js official website', maxResults: 8 },
    AbortSignal.timeout(5_000),
  )
  assert.deepEqual(raw, STRUCTURED)
  assert.equal(fixture.spawns.length, 1)
  const { argv, cwd } = fixture.spawns[0]
  assert.ok(cwd.includes('dsh-web-search-grok-'))
  assert.equal(argv[argv.indexOf('--tools') + 1], SEARCH_TOOL_NAME)
  assert.ok(!argv.includes('--disable-web-search'))
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'streaming-messages-json')
  assert.ok(argv.includes('--verbatim'))
  assert.equal(argv[argv.indexOf('--model') + 1], SEARCH_MODEL)
  assert.equal(argv[argv.indexOf('--reasoning-effort') + 1], SEARCH_EFFORT)
  assert.notEqual(argv[argv.indexOf('--model') + 1], 'grok-4.6')
  assert.notEqual(argv[argv.indexOf('--reasoning-effort') + 1], 'xhigh')
})

test('an aborted search reports WEB_SEARCH_ABORTED rather than a hang', async () => {
  const fixture = fakeCtx(hangingChild())
  const controller = new AbortController()
  const pending = new GrokSearchBackend(fixture.ctx, backendConfig).search(
    { provider: 'grok-cli', model: 'grok-4.5' },
    { query: 'q', maxResults: 8 },
    controller.signal,
  )
  controller.abort(new Error('stop'))
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof GrokWebSearchBackendError && error.code === 'WEB_SEARCH_ABORTED',
  )
})

test('a sanitized Grok web_search failure survives core routing without leaking the raw marker', async () => {
  const SENTINEL = '/home/testuser/.grok/auth.json SENTINEL_LEAK_MARKER'
  const fixture = fakeCtx(searchChild('', SENTINEL, 1))
  const backend = new GrokSearchBackend(fixture.ctx, backendConfig)

  await assert.rejects(
    dispatchPrimarySearch(
      { provider: 'grok-cli', model: 'grok-4.5' },
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
