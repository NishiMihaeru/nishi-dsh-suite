import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../package.json', import.meta.url)
const presetUrl = new URL('../presets/orchestrator/preset.yml', import.meta.url)
const compositionUrl = new URL('../presets/orchestrator/agent.cordis.yml', import.meta.url)

const expectedNishiDependencies = [
  'nishi-dsh-core',
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-claude',
  'nishi-dsh-project-memory',
].sort()

test('suite manifest is a DSH bundle with the exact prerelease package family', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as any

  assert.equal(manifest.name, 'nishi-dsh-suite')
  assert.equal(manifest.version, '0.1.0-rc.3')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.engines?.node, '>=24 <25')
  assert.equal(manifest.bin?.['nishi-dsh-suite'], './lib/bin.js')

  const dependencies = manifest.dependencies ?? {}
  assert.equal(dependencies['@deepseek-ai/dsh-authorization'], '0.1.2-rc.1')

  const nishiDependencies = Object.keys(dependencies).filter((name) => name.startsWith('nishi-dsh-')).sort()
  assert.deepEqual(nishiDependencies, expectedNishiDependencies)
  for (const name of expectedNishiDependencies) {
    assert.equal(dependencies[name], 'workspace:0.1.0-rc.3', `${name} must stay on the exact suite prerelease train`)
  }

  assert.equal(dependencies['nishi-dsh-codex-antigravity'], undefined)
})

test('suite tarball contract includes the packaged orchestrator preset', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as any
  const files = new Set(manifest.files ?? [])

  assert.ok(files.has('presets/**/*.yml'), 'Suite files must include packaged preset YAML')
  assert.equal(
    manifest.exports?.['./presets/orchestrator/preset.yml'],
    './presets/orchestrator/preset.yml',
  )
  assert.equal(
    manifest.exports?.['./presets/orchestrator/agent.cordis.yml'],
    './presets/orchestrator/agent.cordis.yml',
  )

  await access(presetUrl)
  await access(compositionUrl)
})
