import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexSearchBackend } from 'nishi-dsh-codex/web-search-backend'
import { normalizeProviderResult } from '../src/result.ts'

test('PRIMARY WEB SEARCH LIVE: Codex backend composes without DeepSeek fallback', async () => {
  const model = process.env.DSH_LIVE_CODEX_SEARCH_MODEL?.trim()
  assert.ok(model, 'Set DSH_LIVE_CODEX_SEARCH_MODEL')
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const raw = await new CodexSearchBackend().search(
      { provider: 'codex-app-server', model },
      { query: `OpenAI Codex SDK official documentation ${Date.now()}`, maxResults: 8 },
      AbortSignal.timeout(120_000),
    )
    const result = normalizeProviderResult(raw, 8)
    assert.ok(result.sources.length > 0)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})
