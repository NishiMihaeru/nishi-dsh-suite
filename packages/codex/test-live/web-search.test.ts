import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexSearchBackend } from '../src/web-search-backend.ts'

test('CODEX WEB SEARCH LIVE: native Codex search returns structured sources', async () => {
  const model = process.env.DSH_LIVE_CODEX_SEARCH_MODEL?.trim()
  assert.ok(model, 'Set DSH_LIVE_CODEX_SEARCH_MODEL to an authenticated Codex model')
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const raw = await new CodexSearchBackend().search(
      { provider: 'codex-app-server', model },
      { query: `OpenAI Codex SDK official documentation ${Date.now()}`, maxResults: 8 },
      AbortSignal.timeout(120_000),
    ) as any
    assert.ok(Array.isArray(raw?.sources))
    assert.ok(raw.sources.length > 0)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})
