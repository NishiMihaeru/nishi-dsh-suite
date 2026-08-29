import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageLimitsClientController } from '../src/client/controller.ts'
import type { ProviderRosterEntry } from '../src/client/rpc-client.ts'
import { AuthorizationHostController } from '../src/host/authorization-rpc.ts'
import type { ProviderUsageSnapshot, PublicProviderUsage } from '../src/usage/index.ts'
import { UsageLimitsService } from '../src/usage/service.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const POLICY = { minRefreshIntervalMs: 60_000, staleAfterMs: 120_000 } as const

function serviceSnapshot(observedAtMs: number, displayName = 'Fixture'): ProviderUsageSnapshot {
  return {
    providerId: 'fixture',
    displayName,
    status: 'AVAILABLE',
    observedAtMs,
    windows: [],
  }
}

test('usage invalidation immediately drops cached snapshots from every cached read path', async () => {
  const service = new UsageLimitsService([{
    providerId: 'fixture',
    policy: POLICY,
    collector: { collect: async (observedAtMs) => serviceSnapshot(observedAtMs) },
  }], () => 1_000)

  await service.refreshProvider('fixture', { force: true })
  assert.equal(service.getCachedSnapshot('fixture')?.displayName, 'Fixture')
  assert.equal(service.getCachedSnapshots().length, 1)

  service.invalidate('fixture')

  assert.equal(service.getCachedSnapshot('fixture'), undefined)
  assert.deepEqual(service.getCachedSnapshots(), [])
})

test('invalidation that races an in-flight refresh prevents the superseded result from repopulating cache', async () => {
  const gate = deferred<ProviderUsageSnapshot>()
  const service = new UsageLimitsService([{
    providerId: 'fixture',
    policy: POLICY,
    collector: { collect: () => gate.promise },
  }], () => 2_000)

  const refresh = service.refreshProvider('fixture', { force: true })
  service.invalidate('fixture')
  gate.resolve(serviceSnapshot(2_000, 'superseded'))
  assert.equal((await refresh).displayName, 'superseded')

  assert.equal(service.getCachedSnapshot('fixture'), undefined)
  assert.deepEqual(service.getCachedSnapshots(), [])
})

const roster: ProviderRosterEntry[] = [{
  providerId: 'fixture',
  presentation: {
    id: 'fixture',
    displayName: 'Fixture Provider',
    brandColor: '#123456',
  },
}]

const freshUsage: PublicProviderUsage = {
  providerId: 'fixture',
  displayName: 'Fixture Provider',
  status: 'AVAILABLE',
  observedAtMs: 1_000,
  freshness: 'FRESH',
  windows: [],
}

test('an authoritative cached-read omission clears prior client usage so ensureFresh refreshes invalidated data', async () => {
  let cached: PublicProviderUsage[] = [freshUsage]
  let refreshCalls = 0
  const refreshed: PublicProviderUsage = { ...freshUsage, observedAtMs: 2_000 }
  const controller = new UsageLimitsClientController({
    async getRoster() { return roster },
    async getProviders() { return cached },
    async getProvider() { return cached[0] },
    async refreshProvider() {
      refreshCalls += 1
      return refreshed
    },
  })

  await controller.initialize()
  assert.equal(refreshCalls, 0)

  cached = []
  await controller.loadRoster()
  await controller.loadCached()
  await controller.ensureAllFresh()

  assert.equal(refreshCalls, 1)
  assert.equal(controller.getSnapshot().providers.fixture?.usage?.observedAtMs, 2_000)
})

test('legacy logout fails closed: the mutating surface that could race a read-check-delete credential deletion is gone, not stubbed', async () => {
  const grant = { kind: 'grant', payload: { accessToken: 'legacy-token' } }
  let current: any = grant
  let describeCalls = 0
  let deleteCalls = 0
  const controller = new AuthorizationHostController({
    nishiProviders: {
      all: () => [{ id: 'fixture', descriptor: { account: { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' } } }],
    },
    credentials: {
      async describeRecord() {
        describeCalls += 1
        return { configured: true, kind: current.kind, writable: true }
      },
      async deleteRecord() {
        deleteCalls += 1
        current = { kind: 'api-key', key: 'replacement-must-survive' }
      },
    },
  } as any)

  // No `logout` method exists to call: the describe-then-delete race this
  // guarded against has no code path left to race through, rather than a
  // method that still exists only to throw.
  assert.equal(typeof (controller as any).logout, 'undefined')

  const flow = await controller.describeProviderPublic('fixture')
  assert.equal(flow?.status, 'CONNECTED')
  assert.equal(current, grant)
  assert.equal(deleteCalls, 0)
  assert.equal(describeCalls, 1, 'a status read is the only credential-store call this surface can make')
})
