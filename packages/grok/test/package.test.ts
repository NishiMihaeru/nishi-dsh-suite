import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Grok manifest is independent and bundles no vendor runtime', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'nishi-dsh-grok')
  assert.equal(manifest.version, '0.1.0-rc.3')
  assert.equal(manifest.repository?.directory, 'packages/grok')
  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(serialized, /@openai\//)
  assert.doesNotMatch(serialized, /@anthropic-ai\//)
  assert.doesNotMatch(serialized, /xai|x\.ai|grok-sdk/i)
})

test('Grok invariant owns nishi-dsh-grok', async () => {
  const invariant = await import('../src/invariant.ts')
  let owner = ''
  const dispose = () => {}
  const ctx = { invariants: { register(name: string) { owner = name; return dispose } } }
  assert.equal(await invariant.apply(ctx as any), dispose)
  assert.equal(owner, 'nishi-dsh-grok')
})

test('Grok source never opts into a vendor permission bypass', async () => {
  const source = [
    await readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/grok-primary.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/grok-vendor.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/web-search-backend.ts', import.meta.url), 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /'--always-approve'/)
  assert.doesNotMatch(source, /'--yolo'/)
  assert.doesNotMatch(source, /bypassPermissions/)
})

test('Grok source never reads the vendor credential store', async () => {
  const source = [
    await readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/grok-primary.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/model-catalog.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/usage.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/usage-billing.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/web-search-backend.ts', import.meta.url), 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /auth\.json/)
  assert.doesNotMatch(source, /XAI_API_KEY/)
  assert.doesNotMatch(source, /unified\.jsonl/)
})
