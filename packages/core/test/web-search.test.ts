import assert from 'node:assert/strict'
import test from 'node:test'
import { PrimaryWebSearchError } from '../src/web-search/errors.js'
import { normalizeProviderResult } from '../src/web-search/result.js'
import { resolvePrimarySearchRoute, type PrimarySearchRoute } from '../src/web-search/route.js'
import { dispatchPrimarySearch } from '../src/web-search/providers.js'
import type { PrimarySearchBackendResolver } from '../src/web-search/types.js'
import { formatSearchOutput, mergeSearchResults, parseSearchArgs, searchMetaFromValue } from '../src/web-search/tool.js'

function execFixture(input: { cwd?: string; config?: Record<string, unknown> } = {}): any {
  let currentConfig = input.config
  const session = {
    header: input.cwd === undefined ? {} : { cwd: input.cwd },
    requestHeader: () => currentConfig === undefined ? undefined : { config: currentConfig },
    setRequestHeader: (config: Record<string, unknown>) => { currentConfig = config },
  }
  return { agent: { session } }
}

function route(provider: string, model = 'model-1'): PrimarySearchRoute { return { provider, model } }

/**
 * The resolver the registry hands the tool: keyed by route, with no provider
 * known to the core itself. A route absent from this map stands for both
 * "no such provider" and "that provider declares no search capability".
 */
function backends(calls: string[]): PrimarySearchBackendResolver {
  const byRoute = new Map([
    ['codex-app-server', { async search(currentRoute: any, request: any) { calls.push(`codex:${currentRoute.model}:${request.query}`); return { sources: [{ url: 'https://codex.example/result' }] } } }],
    ['antigravity-cli', { async search(currentRoute: any, request: any) { calls.push(`antigravity:${currentRoute.model}:${request.query}`); return { sources: [{ url: 'https://agy.example/result' }] } } }],
  ])
  return (providerRoute) => byRoute.get(providerRoute)
}

test('primary route follows the live session request header without caching', () => {
  const exec = execFixture({
    cwd: 'C:/dsh-workspace',
    config: { provider: 'codex-app-server', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
  })
  assert.deepEqual(resolvePrimarySearchRoute(exec), {
    provider: 'codex-app-server',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    cwd: 'C:/dsh-workspace',
  })
  exec.agent.session.setRequestHeader({
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-medium',
  })
  assert.deepEqual(resolvePrimarySearchRoute(exec), {
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-medium',
    cwd: 'C:/dsh-workspace',
  })
})

test('missing route fails closed with WEB_SEARCH_ROUTE_UNAVAILABLE', () => {
  assert.throws(
    () => resolvePrimarySearchRoute({} as any),
    (error: unknown) => error instanceof PrimaryWebSearchError && error.code === 'WEB_SEARCH_ROUTE_UNAVAILABLE',
  )
  assert.throws(
    () => resolvePrimarySearchRoute(execFixture()),
    (error: unknown) => error instanceof PrimaryWebSearchError && error.code === 'WEB_SEARCH_ROUTE_UNAVAILABLE',
  )
  assert.throws(
    () => resolvePrimarySearchRoute(execFixture({ config: { model: 'gpt-5.6-sol' } })),
    (error: unknown) => error instanceof PrimaryWebSearchError && error.code === 'WEB_SEARCH_ROUTE_UNAVAILABLE',
  )
  assert.throws(
    () => resolvePrimarySearchRoute(execFixture({ config: { provider: 'codex-app-server' } })),
    (error: unknown) => error instanceof PrimaryWebSearchError && error.code === 'WEB_SEARCH_ROUTE_UNAVAILABLE',
  )
  assert.throws(
    () => resolvePrimarySearchRoute(execFixture({ config: { provider: '  ', model: '' } })),
    (error: unknown) => error instanceof PrimaryWebSearchError && error.code === 'WEB_SEARCH_ROUTE_UNAVAILABLE',
  )
})

test('route switching loop: Codex -> Antigravity -> Codex dispatches to corresponding backends dynamically', async () => {
  const calls: string[] = []
  const currentBackends = backends(calls)
  const exec = execFixture({
    cwd: 'C:/dsh-workspace',
    config: { provider: 'codex-app-server', model: 'gpt-5.6-sol' },
  })

  const route1 = resolvePrimarySearchRoute(exec)
  await dispatchPrimarySearch(route1, { query: 'turn 1', maxResults: 8 }, new AbortController().signal, currentBackends)

  exec.agent.session.setRequestHeader({ provider: 'antigravity-cli', model: 'gemini-3.7-flash-medium' })
  const route2 = resolvePrimarySearchRoute(exec)
  await dispatchPrimarySearch(route2, { query: 'turn 2', maxResults: 8 }, new AbortController().signal, currentBackends)

  exec.agent.session.setRequestHeader({ provider: 'codex-app-server', model: 'gpt-5.6-sol' })
  const route3 = resolvePrimarySearchRoute(exec)
  await dispatchPrimarySearch(route3, { query: 'turn 3', maxResults: 8 }, new AbortController().signal, currentBackends)

  assert.deepEqual(calls, [
    'codex:gpt-5.6-sol:turn 1',
    'antigravity:gemini-3.7-flash-medium:turn 2',
    'codex:gpt-5.6-sol:turn 3',
  ])
})

test('provider dispatch uses exact managed route and never falls back', async () => {
  const calls: string[] = []
  await dispatchPrimarySearch(
    route('codex-app-server', 'gpt-5.6-sol'),
    { query: 'latest', maxResults: 8 },
    new AbortController().signal,
    backends(calls),
  )
  await dispatchPrimarySearch(
    route('antigravity-cli', 'gemini-3.7-flash-medium'),
    { query: 'current', maxResults: 8 },
    new AbortController().signal,
    backends(calls),
  )
  assert.deepEqual(calls, ['codex:gpt-5.6-sol:latest', 'antigravity:gemini-3.7-flash-medium:current'])

  const unsupportedCalls: string[] = []
  await assert.rejects(
    dispatchPrimarySearch(
      route('deepseek-official', 'deepseek-v4-flash'),
      { query: 'no fallback', maxResults: 8 },
      new AbortController().signal,
      backends(unsupportedCalls),
    ),
    (error: unknown) => error instanceof PrimaryWebSearchError
      && error.code === 'WEB_SEARCH_UNSUPPORTED'
      && !error.message.includes('DEEPSEEK_API_KEY'),
  )
  assert.deepEqual(unsupportedCalls, [])
})

test('provider normalization validates URLs, dedupes, trims, and truncates', () => {
  assert.deepEqual(normalizeProviderResult({
    content: ' answer ',
    sources: [
      { url: 'https://example.com/a', title: ' A ', snippet: ' first ', publishedAt: '' },
      { url: 'https://example.com/a', title: 'duplicate' },
      { url: 'http://example.org/b', title: '', snippet: ' second ' },
      { url: 'https://example.net/c' },
    ],
  }, 2), {
    content: 'answer',
    sources: [
      { url: 'https://example.com/a', title: 'A', snippet: 'first' },
      { url: 'http://example.org/b', snippet: 'second' },
    ],
    truncated: true,
  })
  assert.throws(
    () => normalizeProviderResult({ sources: [{ url: 'file:///etc/passwd' }] }, 8),
    (error: unknown) => error instanceof PrimaryWebSearchError && error.code === 'WEB_SEARCH_PROTOCOL',
  )
})

test('copied web_search consumer keeps query and presentation semantics', () => {
  assert.deepEqual(parseSearchArgs({ queries: ['one', 'one', 'two'] }, 4), ['one', 'two'])
  assert.throws(() => parseSearchArgs({ queries: [] }, 4), /at least one/)
  const merged = mergeSearchResults(['a', 'b'], [
    { content: 'A', sources: [{ url: 'https://a.example/1' }, { url: 'https://shared.example/' }], truncated: false },
    { content: 'B', sources: [{ url: 'https://b.example/1' }, { url: 'https://shared.example/' }, { url: 'https://b.example/3' }], truncated: false },
  ], 3)
  assert.deepEqual(merged.sources.map(source => source.url), [
    'https://a.example/1',
    'https://b.example/1',
    'https://shared.example/',
  ])
  assert.equal(merged.truncated, true)
  const output = formatSearchOutput({
    sources: [{ url: 'https://example.com/', title: 'Example' }],
    truncated: false,
  })
  assert.match(output, /\[Example\]\(https:\/\/example\.com\/\)/)
  assert.match(output, /Cite the relevant URLs/)
  assert.deepEqual(searchMetaFromValue({
    content: 'answer',
    sources: [{ url: 'https://example.com/' }],
    truncated: false,
  }), {
    answer: 'answer',
    sources: [{ url: 'https://example.com/' }],
    truncated: false,
  })
})
