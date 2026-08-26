import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('primary web search owns one tool and composes provider backend seams', async () => {
  const providers = await readFile(new URL('../src/providers.ts', import.meta.url), 'utf8')
  const tool = await readFile(new URL('../src/tool.ts', import.meta.url), 'utf8')
  const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  const source = `${providers}\n${tool}\n${index}`

  assert.match(providers, /nishi-dsh-codex\/web-search-backend/)
  assert.match(providers, /nishi-dsh-antigravity\/web-search-backend/)
  assert.equal((tool.match(/name:\s*'web_search'/g) ?? []).length, 1)
  assert.doesNotMatch(source, /ctx\.web\b/)
  assert.doesNotMatch(source, /DEEPSEEK_API_KEY/)
  assert.doesNotMatch(source, /deepseek-official/)
  assert.doesNotMatch(source, /exa/i)
  assert.doesNotMatch(source, /perplexity/i)
})

test('provider package roots do not own web_search registration', async () => {
  const codex = await readFile(new URL('../../codex/src/index.ts', import.meta.url), 'utf8')
  const antigravity = await readFile(new URL('../../antigravity/src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(codex, /name:\s*['"]web_search['"]/)
  assert.doesNotMatch(antigravity, /name:\s*['"]web_search['"]/)
})
