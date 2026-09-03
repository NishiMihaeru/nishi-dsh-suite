import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

const compositionUrl = new URL('../presets/orchestrator/agent.cordis.yml', import.meta.url)

interface Row {
  id?: string
  name?: string
  config?: Row[] | Record<string, unknown>
}

async function delegationRows(): Promise<Row[]> {
  // `!!js` scalars in this composition are DSH loader tags; the parser leaves
  // them unresolved, which is harmless here because no delegation row uses one.
  const composition = parse(await readFile(compositionUrl, 'utf8'), { logLevel: 'silent' }) as Row[]
  const delegation = composition.find((row) => row.id === 'delegation')
  assert.ok(delegation !== undefined, 'orchestrator preset must keep a delegation group')
  assert.ok(Array.isArray(delegation.config), 'the delegation group must carry rows')
  return delegation.config
}

function row(rows: Row[], id: string): Row {
  const found = rows.find((candidate) => candidate.id === id)
  assert.ok(found !== undefined, `delegation group must contain "${id}"`)
  return found
}

function config(candidate: Row): Record<string, unknown> {
  assert.ok(
    candidate.config !== undefined && !Array.isArray(candidate.config),
    `${candidate.id} must carry a config mapping`,
  )
  return candidate.config
}

test('spawned delegation may select any registered primary route', async () => {
  const rows = await delegationRows()
  const subagent = config(row(rows, 'tool-subagent'))

  assert.equal(subagent.provider, 'spawn')
  assert.equal(subagent.toolName, 'subagent')
  // Without this flag a child is pinned to the parent's route, so no Suite
  // provider — and no DSH provider either — is reachable as a subagent model.
  assert.equal(subagent.modelSelectionSettings, true)
  // Parent (depth 0) may spawn; a child (depth 1) must not. Default is 3.
  assert.equal(subagent.maxDepth, 1)
})

test('forked delegation stays on the parent route', async () => {
  const rows = await delegationRows()
  const fork = config(row(rows, 'tool-subagent-fork'))

  assert.equal(fork.provider, 'fork')
  assert.equal(fork.toolName, 'subagent_fork')
  // A forked child inherits the parent's completed-turn prefix; changing the
  // route would make that prefix ineligible for KV Cache reuse.
  assert.equal(fork.modelSelectionSettings, undefined)
  assert.equal(fork.maxDepth, 1)
})

test('the preset contributes no subagent provider of its own', async () => {
  const rows = await delegationRows()
  const providers = rows
    .filter((candidate) => candidate.name === '@deepseek-ai/dsh-tool-subagent')
    .map((candidate) => config(candidate).provider)

  assert.deepEqual(providers, ['spawn', 'fork'])
  for (const retired of ['tool-subagent-codex', 'tool-subagent-antigravity', 'tool-subagent-claude-code']) {
    assert.equal(rows.find((candidate) => candidate.id === retired), undefined, `${retired} was retired in rc.3`)
  }
})

test('the model-selection settings singleton is left to the surrounding profile', async () => {
  const raw = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  // The Host service is a singleton mounted by the official web-app bundle;
  // a second copy from this bundle would conflict with it.
  assert.ok(
    !raw.includes('model-selection-settings'),
    'the Suite bundle patch must not mount a second subagent-model-selection service',
  )
})
