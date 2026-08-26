import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Codex package manifest has independent public identity without bundled vendor runtimes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'nishi-dsh-codex')
  assert.equal(manifest.version, '0.1.0-rc.1')
  assert.equal(manifest.dependencies?.['@openai/codex'], undefined)
  assert.equal(manifest.dependencies?.['@openai/codex-sdk'], undefined)
  assert.equal(manifest.dependencies?.['codex-plugin-dsh'], undefined)
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-session'], '0.1.1-rc.2')
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-attachment'], '0.1.1-rc.2')
  assert.equal(manifest.exports?.['./web-search-backend']?.default, './lib/web-search-backend.js')
  assert.equal(JSON.stringify(manifest).includes('antigravity'), false)
})

test('Codex package invariant owns only nishi-dsh-codex', async () => {
  const invariant = await import('../src/invariant.ts')
  let owner = ''
  const dispose = () => {}
  const ctx = { invariants: { register(name: string) { owner = name; return dispose } } }
  assert.equal(await invariant.apply(ctx as any), dispose)
  assert.equal(owner, 'nishi-dsh-codex')
})

test('Codex README records memory suppression and accepted upstream debt', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /memories\.use_memories=false/)
  assert.match(readme, /memories\.generate_memories=false/)
  assert.match(readme, /project_doc_max_bytes=0/)
  assert.match(readme, /CODEX-GLOBAL-AGENTS-001/)
  assert.match(readme, /ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT/)
})
