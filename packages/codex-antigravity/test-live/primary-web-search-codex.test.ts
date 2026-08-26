import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexSearchBackend } from '../src/primary-web-search/codex.ts'
import { normalizeProviderResult } from '../src/primary-web-search/result.ts'

function withoutDeepSeekKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  return run().finally(() => {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  })
}

test('PRIMARY WEB SEARCH LIVE: Codex uses native web search without DEEPSEEK_API_KEY', async () => {
  const model = process.env.DSH_LIVE_CODEX_SEARCH_MODEL?.trim()
  assert.ok(model, 'Set DSH_LIVE_CODEX_SEARCH_MODEL to a model available to the authenticated Codex runtime')

  const backend = new CodexSearchBackend()
  const raw = await withoutDeepSeekKey(() => backend.search(
    { provider: 'codex-app-server', model },
    {
      query: `OpenAI Codex SDK official documentation web search ${Date.now()}`,
      maxResults: 8,
    },
    AbortSignal.timeout(120_000),
  ))
  const result = normalizeProviderResult(raw, 8)

  assert.ok(result.sources.length > 0, `Expected at least one native Codex web source, got ${JSON.stringify(result)}`)
  for (const source of result.sources) assert.match(source.url, /^https?:\/\//)
})
