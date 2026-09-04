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

/**
 * Every preset row that can start a child agent, and whether the row bounds
 * recursion. `maxDepth` is enforced by the subagent PROVIDER, from a value the
 * calling tool passes per request: `resolveChildDepth(parent, request.maxDepth)`
 * refuses when `parent depth + 1 > maxDepth`, and an absent cap refuses
 * nothing. The spawn provider advertises `depthLimit` but carries no default of
 * its own, so an uncapped caller is uncapped in fact.
 */
const CHILD_STARTING_ROWS: ReadonlyArray<{ id: string; capped: boolean; why: string }> = [
  { id: 'tool-subagent', capped: true, why: 'the delegation tool children also mount' },
  { id: 'tool-subagent-fork', capped: true, why: 'the fork tool children also mount' },
  {
    id: 'tool-workflow',
    capped: false,
    why: 'upstream `@deepseek-ai/dsh-tool-workflow` Config accepts only `toolName` and '
      + '`maxResultChars`; it passes no `maxDepth` and offers no knob to set one',
  },
  {
    id: 'tool-ralph',
    capped: false,
    why: 'upstream `@deepseek-ai/dsh-tool-ralph` Config accepts `subagentProvider`, `maxRounds` '
      + 'and the char caps; it passes no `maxDepth`',
  },
  {
    id: 'workflow-worker-thread',
    capped: false,
    why: 'the worker-thread provider row names a subagent provider and passes no `maxDepth`',
  },
]

test('every child-starting preset row is either depth-capped or a recorded exception', async () => {
  // The guard this file was missing. `subagent` and `subagent_fork` are capped
  // at depth 1, which is what stops a child delegating again -- but children
  // keep this same catalog, and `workflow`, `ralph` and the worker-thread row
  // start children too. A future row that spawns without a cap, or an upstream
  // package that grows a `maxDepth` knob this preset does not set, must fail
  // here rather than widen the tree silently.
  const rows = await delegationRows()
  const composition = parse(await readFile(compositionUrl, 'utf8'), { logLevel: 'silent' }) as Row[]
  const everyRow = composition.flatMap(group => (Array.isArray(group.config) ? group.config : [group]))

  for (const expected of CHILD_STARTING_ROWS) {
    const found = everyRow.find(candidate => candidate.id === expected.id)
    assert.ok(found !== undefined, `${expected.id} must still be in the preset (${expected.why})`)
    const rowConfig = found.config !== undefined && !Array.isArray(found.config) ? found.config : {}
    assert.equal(
      'maxDepth' in rowConfig,
      expected.capped,
      expected.capped
        ? `${expected.id} must carry maxDepth: ${expected.why}`
        : `${expected.id} now carries maxDepth; the recorded exception is stale: ${expected.why}`,
    )
  }

  // No delegation row may start children without appearing above. A new row
  // naming a subagent provider is a new recursion vector.
  const delegationProviderRows = rows.filter(candidate => {
    const rowConfig = candidate.config !== undefined && !Array.isArray(candidate.config) ? candidate.config : {}
    return 'provider' in rowConfig || 'subagentProvider' in rowConfig
  })
  for (const candidate of delegationProviderRows) {
    assert.ok(
      CHILD_STARTING_ROWS.some(known => known.id === candidate.id),
      `delegation row "${candidate.id}" starts children but is not recorded in CHILD_STARTING_ROWS`,
    )
  }
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
