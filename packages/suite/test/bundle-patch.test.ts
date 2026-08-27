import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

const patchUrl = new URL('../cordis.patch.yml', import.meta.url)

const expectedRows = new Map([
  ['nishi-authorization', '@deepseek-ai/dsh-authorization'],
  ['nishi-project-memory', 'nishi-dsh-project-memory'],
  ['nishi-codex', 'nishi-dsh-codex'],
  ['nishi-antigravity', 'nishi-dsh-antigravity'],
  ['nishi-usage-limits-host', 'nishi-dsh-usage-limits-host'],
])

test('bundle patch mounts each host runtime plugin exactly once', async () => {
  const raw = await readFile(patchUrl, 'utf8')
  const patch = parse(raw) as any[]

  assert.ok(Array.isArray(patch))
  assert.equal(patch.length, 1)
  assert.ok(Array.isArray(patch[0]?.insert))

  const rows = patch[0].insert as Array<{ id?: string; name?: string; config?: unknown }>
  assert.equal(rows.length, expectedRows.size)

  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const row of rows) {
    assert.equal(typeof row.id, 'string')
    assert.equal(typeof row.name, 'string')
    assert.ok(!seenIds.has(row.id!), `duplicate row id: ${row.id}`)
    assert.ok(!seenNames.has(row.name!), `duplicate runtime package row: ${row.name}`)
    seenIds.add(row.id!)
    seenNames.add(row.name!)
    assert.equal(expectedRows.get(row.id!), row.name)
  }

  assert.deepEqual(new Set(seenIds), new Set(expectedRows.keys()))
  assert.deepEqual(new Set(seenNames), new Set(expectedRows.values()))

  for (const dependencyOnly of [
    'nishi-dsh-primary-web-search',
    'nishi-dsh-usage-limits',
    'nishi-dsh-codex-usage-source',
    'nishi-dsh-claude-usage-source',
    'nishi-dsh-provider-kit',
  ]) {
    assert.ok(!seenNames.has(dependencyOnly), `${dependencyOnly} must not be mounted as a host Cordis row`)
  }

  for (const retired of [
    'nishi-dsh-codex-antigravity',
    '@dsh-plugin/project-memory',
    'dsh-subagent-codex-custom/primary-web-search',
  ]) {
    assert.ok(!raw.includes(retired), `retired package boundary remains in bundle patch: ${retired}`)
  }

  assert.ok(
    rows.every((row) => row.id !== 'agent-presets' && row.name !== '@deepseek-ai/dsh-agent-presets'),
    'DSH rc.2 preset-root workaround must not be mounted as a bundle row',
  )
})
