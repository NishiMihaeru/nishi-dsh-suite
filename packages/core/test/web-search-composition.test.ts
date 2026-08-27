import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const webSearchDir = new URL('../src/web-search/', import.meta.url)

/**
 * Prose explains why something is absent — "there is deliberately no
 * DeepSeek/Exa/Perplexity fallback" — so these checks read the code with
 * comments stripped. Otherwise documenting an absence would fail the test
 * that asserts it.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

async function webSearchSource(): Promise<string> {
  const files = await readdir(webSearchDir)
  const contents = await Promise.all(
    files.filter((file) => file.endsWith('.ts')).map((file) => readFile(new URL(file, webSearchDir), 'utf8')),
  )
  return withoutComments(contents.join('\n'))
}

test('the routed web_search tool names no provider and imports no provider package', async () => {
  const source = await webSearchSource()

  assert.doesNotMatch(source, /nishi-dsh-codex/, 'the core resolves backends through the registry')
  assert.doesNotMatch(source, /nishi-dsh-antigravity/)
  assert.doesNotMatch(source, /codex/i, 'no provider may be named in the core')
  assert.doesNotMatch(source, /antigravity/i)
})

test('there is exactly one web_search tool and no fallback search engine', async () => {
  const source = await webSearchSource()
  const tool = withoutComments(await readFile(new URL('tool.ts', webSearchDir), 'utf8'))

  assert.equal((tool.match(/name:\s*'web_search'/g) ?? []).length, 1)
  assert.doesNotMatch(source, /ctx\.web\b/)
  assert.doesNotMatch(source, /DEEPSEEK_API_KEY/)
  assert.doesNotMatch(source, /deepseek-official/)
  assert.doesNotMatch(source, /\bexa\b/i)
  assert.doesNotMatch(source, /\bperplexity\b/i)
})

test('an unknown or search-less primary fails closed rather than falling back', async () => {
  const providers = await readFile(new URL('providers.ts', webSearchDir), 'utf8')
  assert.match(providers, /WEB_SEARCH_UNSUPPORTED/)
})

test('provider packages do not register the model-facing web_search tool', async () => {
  const codex = await readFile(new URL('../../codex/src/index.ts', import.meta.url), 'utf8')
  const antigravity = await readFile(new URL('../../antigravity/src/index.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(codex, /name:\s*['"]web_search['"]/)
  assert.doesNotMatch(antigravity, /name:\s*['"]web_search['"]/)
  assert.match(codex, /webSearch:/, 'a provider contributes a backend, not a tool')
  assert.match(antigravity, /webSearch:/)
})
