import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageLimitsClientController } from '../src/client/controller.ts'
import { NEUTRAL_BRAND_COLOR, type ProviderRosterEntry } from '../src/client/rpc-client.ts'
import { buildUsageGroupsForProvider } from '../src/client/usage-group-model.ts'
import { usageGroupAccent } from '../src/client/ui/ProviderLogo.tsx'
import type { PublicProviderUsage } from '../src/usage/index.ts'

function entry(id: string, extra: Record<string, unknown> = {}): ProviderRosterEntry {
  return { providerId: id, presentation: { id, displayName: id.toUpperCase(), brandColor: '#111111', ...extra } }
}

function usage(providerId: string, windows: PublicProviderUsage['windows']): PublicProviderUsage {
  return {
    providerId,
    displayName: providerId,
    status: 'AVAILABLE',
    observedAtMs: 1_000,
    freshness: 'FRESH',
    windows,
  }
}

function rpc(roster: ProviderRosterEntry[], cached: PublicProviderUsage[] = []) {
  const calls: string[] = []
  return {
    calls,
    rpc: {
      async getRoster() { calls.push('roster'); return roster },
      async getProviders() { calls.push('providers'); return cached },
      async getProvider() { return null },
      async refreshProvider(providerId: string) {
        calls.push(`refresh:${providerId}`)
        return usage(providerId, [])
      },
    },
  }
}

test('the browser learns which providers exist from the host', async () => {
  const fixture = rpc([entry('codex'), entry('claude')])
  const controller = new UsageLimitsClientController(fixture.rpc as any)

  await controller.initialize()

  const snapshot = controller.getSnapshot()
  assert.deepEqual(snapshot.roster.map((item) => item.providerId), ['codex', 'claude'])
  assert.deepEqual(Object.keys(snapshot.providers).sort(), ['claude', 'codex'])
  assert.equal(fixture.calls[0], 'roster', 'the roster is learned before anything is refreshed')
})

test('a provider that is not mounted leaves no row at all', async () => {
  const fixture = rpc([entry('codex')])
  const controller = new UsageLimitsClientController(fixture.rpc as any)

  await controller.initialize()

  assert.deepEqual(Object.keys(controller.getSnapshot().providers), ['codex'])
  assert.equal(fixture.calls.includes('refresh:claude'), false, 'no placeholder provider is ever refreshed')
})

test('a provider mounted later appears on the next refresh', async () => {
  const roster = [entry('codex')]
  const fixture = rpc(roster)
  const controller = new UsageLimitsClientController(fixture.rpc as any)
  await controller.initialize()

  roster.push(entry('antigravity'))
  await controller.refreshAll()

  assert.deepEqual(controller.getSnapshot().roster.map((item) => item.providerId), ['codex', 'antigravity'])
  assert.ok(fixture.calls.includes('refresh:antigravity'))
})

test('a failed roster call leaves the surface empty rather than inventing providers', async () => {
  const controller = new UsageLimitsClientController({
    async getRoster() { throw new Error('unavailable') },
    async getProviders() { return [] },
    async getProvider() { return null },
    async refreshProvider() { throw new Error('unavailable') },
  } as any)

  await controller.initialize()

  assert.deepEqual(controller.getSnapshot().roster, [])
  assert.deepEqual(controller.getSnapshot().providers, {})
  assert.equal(controller.getSnapshot().phase, 'ready')
})

test('a provider declaring pools groups its bucket windows by the scope it emitted', () => {
  const windows: PublicProviderUsage['windows'] = [
    { id: 'a', label: 'Gemini Session Limit', kind: 'SHORT', usedPercent: 10, scope: { kind: 'BUCKET', id: 'gemini', label: 'Gemini' } },
    { id: 'b', label: 'Claude / GPT Session Limit', kind: 'SHORT', usedPercent: 20, scope: { kind: 'BUCKET', id: 'external', label: 'Claude / GPT' } },
  ]
  const groups = buildUsageGroupsForProvider({
    presentation: entry('agy', { bucketsAsPools: true }).presentation,
    loadStatus: 'ready',
    usage: usage('agy', windows),
  })

  assert.deepEqual(groups.map((group) => group.displayName), ['Claude / GPT', 'Gemini'])
  assert.deepEqual(groups.map((group) => group.kind), ['POOL', 'POOL'])
  assert.deepEqual(groups.map((group) => group.presentation.id), ['agy', 'agy'])
})

test('a provider not declaring pools folds bucket windows into its own row', () => {
  const windows: PublicProviderUsage['windows'] = [
    { id: 'a', label: 'Weekly', kind: 'WEEKLY', usedPercent: 10, scope: { kind: 'PROVIDER' } },
    { id: 'b', label: 'Session', kind: 'SHORT', usedPercent: 20, scope: { kind: 'BUCKET', id: 'pool' } },
  ]
  const groups = buildUsageGroupsForProvider({
    presentation: entry('codex').presentation,
    loadStatus: 'ready',
    usage: usage('codex', windows),
  })

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.kind, 'PROVIDER')
  assert.deepEqual(groups[0]?.windows.map((win) => win.id), ['b', 'a'])
})

test('a provider that declares no colour renders the neutral accent', () => {
  const groups = buildUsageGroupsForProvider({
    presentation: { id: 'unknown', displayName: 'Unknown', brandColor: '' },
    loadStatus: 'idle',
  })

  assert.equal(usageGroupAccent(groups[0]!), NEUTRAL_BRAND_COLOR)
})
