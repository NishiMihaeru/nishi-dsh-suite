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

test('legacy logout never deletes an api-key record that replaced the grant after observation', async () => {
  let current: any = { kind: 'grant', payload: { accessToken: 'legacy-token' } }
  let describeCalls = 0
  let deleteCalls = 0
  const controller = new AuthorizationHostController({
    credentials: {
      async describeRecord() {
        describeCalls += 1
        const observed = current
        if (describeCalls === 1) current = { kind: 'api-key', key: 'replacement-api-key' }
        return observed === undefined
          ? { configured: false, writable: true }
          : { configured: true, kind: observed.kind, writable: true }
      },
      async deleteRecord() {
        deleteCalls += 1
        current = undefined
      },
    },
  } as any)

  const flow = await controller.logout('openai-codex')

  assert.equal(current?.kind, 'api-key')
  assert.equal(current?.key, 'replacement-api-key')
  assert.equal(deleteCalls, 0)
  assert.equal(flow.credentialKind, 'api-key')
  assert.equal(flow.status, 'NOT_CONFIGURED')
})
