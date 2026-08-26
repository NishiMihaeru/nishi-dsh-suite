import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  installOrchestratorPreset,
  inspectOrchestratorPreset,
  removeOrchestratorPreset,
  updateOrchestratorPreset,
} from '../src/preset-manager.js'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fixture(): Promise<{ root: string; dshHome: string; sourceRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'nishi-dsh-suite-preset-'))
  const dshHome = join(root, 'dsh-home')
  const sourceRoot = join(root, 'source')
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(join(sourceRoot, 'preset.yml'), 'name: Orchestrator\n', 'utf8')
  await writeFile(join(sourceRoot, 'agent.cordis.yml'), '- id: first\n  name: first-plugin\n', 'utf8')
  return { root, dshHome, sourceRoot }
}

function options(dshHome: string, sourceRoot: string, suiteVersion = 'test-v1') {
  return { dshHome, sourceRoot, suiteVersion }
}

test('install creates a managed orchestrator under the DSH user preset root', async (t) => {
  const { root, dshHome, sourceRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await installOrchestratorPreset(options(dshHome, sourceRoot))
  assert.equal(result.changed, true)
  assert.equal(result.state, 'current')
  assert.equal(result.target, join(dshHome, '.agent-presets', 'orchestrator'))

  assert.equal(await readFile(join(result.target, 'preset.yml'), 'utf8'), 'name: Orchestrator\n')
  assert.equal(
    await readFile(join(result.target, 'agent.cordis.yml'), 'utf8'),
    '- id: first\n  name: first-plugin\n',
  )
  assert.equal(await exists(join(result.target, '.nishi-dsh-suite-preset.json')), true)

  const status = await inspectOrchestratorPreset(options(dshHome, sourceRoot))
  assert.equal(status.state, 'current')
})

test('install is idempotent when the managed preset already matches the package', async (t) => {
  const { root, dshHome, sourceRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  await installOrchestratorPreset(options(dshHome, sourceRoot))
  const second = await installOrchestratorPreset(options(dshHome, sourceRoot))

  assert.equal(second.changed, false)
  assert.equal(second.state, 'current')
})

test('install refuses to overwrite an unmanaged preset directory', async (t) => {
  const { root, dshHome, sourceRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const target = join(dshHome, '.agent-presets', 'orchestrator')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'agent.cordis.yml'), 'user-owned\n', 'utf8')

  await assert.rejects(
    installOrchestratorPreset(options(dshHome, sourceRoot)),
    /not managed by nishi-dsh-suite/i,
  )
  assert.equal(await readFile(join(target, 'agent.cordis.yml'), 'utf8'), 'user-owned\n')
})

test('update atomically replaces an unmodified managed preset when package content changes', async (t) => {
  const { root, dshHome, sourceRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  await installOrchestratorPreset(options(dshHome, sourceRoot, 'test-v1'))
  await writeFile(join(sourceRoot, 'agent.cordis.yml'), '- id: second\n  name: second-plugin\n', 'utf8')

  const before = await inspectOrchestratorPreset(options(dshHome, sourceRoot, 'test-v2'))
  assert.equal(before.state, 'outdated')

  const updated = await updateOrchestratorPreset(options(dshHome, sourceRoot, 'test-v2'))
  assert.equal(updated.changed, true)
  assert.equal(updated.state, 'current')
  assert.equal(
    await readFile(join(updated.target, 'agent.cordis.yml'), 'utf8'),
    '- id: second\n  name: second-plugin\n',
  )
})

test('local edits make the managed preset modified and block update and removal', async (t) => {
  const { root, dshHome, sourceRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const installed = await installOrchestratorPreset(options(dshHome, sourceRoot))
  await writeFile(join(installed.target, 'agent.cordis.yml'), 'local edit\n', 'utf8')

  const status = await inspectOrchestratorPreset(options(dshHome, sourceRoot))
  assert.equal(status.state, 'modified')

  await assert.rejects(
    updateOrchestratorPreset(options(dshHome, sourceRoot, 'test-v2')),
    /locally modified/i,
  )
  await assert.rejects(
    removeOrchestratorPreset(options(dshHome, sourceRoot)),
    /locally modified/i,
  )
  assert.equal(await readFile(join(installed.target, 'agent.cordis.yml'), 'utf8'), 'local edit\n')
})

test('remove deletes only the managed orchestrator and preserves sibling user presets', async (t) => {
  const { root, dshHome, sourceRoot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const sibling = join(dshHome, '.agent-presets', 'personal')
  await mkdir(sibling, { recursive: true })
  await writeFile(join(sibling, 'agent.cordis.yml'), 'personal\n', 'utf8')

  const installed = await installOrchestratorPreset(options(dshHome, sourceRoot))
  const removed = await removeOrchestratorPreset(options(dshHome, sourceRoot))

  assert.equal(removed.changed, true)
  assert.equal(removed.state, 'absent')
  assert.equal(await exists(installed.target), false)
  assert.equal(await readFile(join(sibling, 'agent.cordis.yml'), 'utf8'), 'personal\n')
})
