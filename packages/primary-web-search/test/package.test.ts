import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('primary web search package has exact split-package dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'nishi-dsh-primary-web-search')
  assert.equal(manifest.version, '0.1.0-rc.2')
  assert.equal(manifest.dependencies?.['nishi-dsh-codex'], 'workspace:0.1.0-rc.2')
  assert.equal(manifest.dependencies?.['nishi-dsh-antigravity'], 'workspace:0.1.0-rc.2')
  assert.equal(manifest.dependencies?.['@openai/codex'], undefined)
  assert.equal(manifest.dependencies?.['@openai/codex-sdk'], undefined)
})

test('primary web search README documents fail-closed routing', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /codex-app-server/)
  assert.match(readme, /antigravity-cli/)
  assert.match(readme, /WEB_SEARCH_UNSUPPORTED/)
  assert.match(readme, /no .*DEEPSEEK_API_KEY/i)
})
