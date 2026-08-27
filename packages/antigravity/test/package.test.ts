import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Antigravity manifest is independent and contains no OpenAI dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'nishi-dsh-antigravity')
  assert.equal(manifest.version, '0.1.0-rc.3')
  assert.equal(manifest.exports?.['./web-search-backend']?.default, './lib/web-search-backend.js')
  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(serialized, /@openai\/codex/)
  assert.doesNotMatch(serialized, /@openai\/codex-sdk/)
})

test('Antigravity invariant owns nishi-dsh-antigravity', async () => {
  const invariant = await import('../src/invariant.ts')
  let owner = ''
  const dispose = () => {}
  const ctx = { invariants: { register(name: string) { owner = name; return dispose } } }
  assert.equal(await invariant.apply(ctx as any), dispose)
  assert.equal(owner, 'nishi-dsh-antigravity')
})

test('Antigravity source does not opt into dangerous permission bypass', async () => {
  const source = [
    await readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/antigravity-primary.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/web-search-backend.ts', import.meta.url), 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /--dangerously-skip-permissions/)
})
