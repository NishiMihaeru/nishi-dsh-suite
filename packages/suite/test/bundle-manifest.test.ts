import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../package.json', import.meta.url)
const presetUrl = new URL('../presets/orchestrator/preset.yml', import.meta.url)
const compositionUrl = new URL('../presets/orchestrator/agent.cordis.yml', import.meta.url)

const expectedDependencies = [
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-claude-code',
  'nishi-dsh-primary-web-search',
  'nishi-dsh-project-memory',
  'nishi-dsh-usage-limits',
  'nishi-dsh-usage-limits-host',
  'nishi-dsh-codex-usage-source',
].sort()

test('suite manifest is a DSH bundle with the exact prerelease package family', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as any

  assert.equal(manifest.name, 'nishi-dsh-suite')
  assert.equal(manifest.version, '0.1.0-rc.1')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.engines?.node, '>=24 <25')

  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), expectedDependencies)
  for (const name of expectedDependencies) {
    assert.equal(manifest.dependencies[name], 'workspace:0.1.0-rc.1', `${name} must stay on the exact suite prerelease train`)
  }

  assert.equal(manifest.dependencies['nishi-dsh-codex-antigravity'], undefined)
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
