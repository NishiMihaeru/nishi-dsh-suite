import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageLimitsClientController } from '../src/client/controller.ts'
import type { ProviderRosterEntry, UsageLimitsBrowserRpc } from '../src/client/rpc-client.ts'
import type { PublicProviderUsage } from '../src/usage/index.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function entry(id: string): ProviderRosterEntry {
  return {
    providerId: id,
    presentation: { id, displayName: id.toUpperCase(), brandColor: '#111111' },
  }
}

function usage(providerId: string, observedAtMs: number): PublicProviderUsage {
  return {
    providerId,
    displayName: providerId.toUpperCase(),
    status: 'AVAILABLE',
    observedAtMs,
    staleAtMs: observedAtMs + 60_000,
    freshness: 'FRESH',
    windows: [],
  }
}

test('a refresh from an older roster generation cannot resurrect a removed provider', async () => {
  let roster: ProviderRosterEntry[] = [entry('fixture')]
  const oldRefresh = deferred<PublicProviderUsage>()
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() { return roster },
    async getProviders() { return [] },
    async getProvider() { return null },
    async refreshProvider() { return oldRefresh.promise },
  }
  const controller = new UsageLimitsClientController(rpc)

  await controller.loadRoster()
  const pending = controller.refreshProvider('fixture')

  roster = []
  await controller.loadRoster()
  assert.deepEqual(controller.getSnapshot().providers, {})

  oldRefresh.resolve(usage('fixture', 1_000))
  await pending

  assert.deepEqual(controller.getSnapshot().roster, [])
  assert.deepEqual(controller.getSnapshot().providers, {}, 'the stale refresh must not recreate the withdrawn row')
})

test('a newer roster generation starts its own refresh and an old finally cannot delete it', async () => {
  const roster = [entry('fixture')]
  const oldRefresh = deferred<PublicProviderUsage>()
  const newRefresh = deferred<PublicProviderUsage>()
  let refreshCalls = 0
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() { return roster },
    async getProviders() { return [] },
    async getProvider() { return null },
    async refreshProvider() {
      refreshCalls++
      if (refreshCalls === 1) return oldRefresh.promise
      if (refreshCalls === 2) return newRefresh.promise
      throw new Error('unexpected third refresh')
    },
  }
  const controller = new UsageLimitsClientController(rpc)

  await controller.loadRoster()
  const pendingOld = controller.refreshProvider('fixture')

  // A fresh roster read is a new topology generation even if the same id is
  // present. This covers an unload/reload that happened between roster polls.
  await controller.loadRoster()
  const pendingNew = controller.refreshProvider('fixture')
  assert.equal(refreshCalls, 2)

  oldRefresh.resolve(usage('fixture', 1_000))
  await pendingOld

  // If the old finally blindly deleted by provider id, this call would start
  // a third vendor request instead of joining the live new-generation one.
  const joined = controller.refreshProvider('fixture')
  assert.equal(refreshCalls, 2, 'the new-generation in-flight refresh must survive the old finally')

  newRefresh.resolve(usage('fixture', 2_000))
  await Promise.all([pendingNew, joined])

  assert.equal(controller.getSnapshot().providers.fixture?.usage?.observedAtMs, 2_000)
})

test('an older roster response cannot overwrite a newer roster response', async () => {
  const first = deferred<ProviderRosterEntry[]>()
  const second = deferred<ProviderRosterEntry[]>()
  let calls = 0
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() {
      calls++
      return calls === 1 ? first.promise : second.promise
    },
    async getProviders() { return [] },
    async getProvider() { return null },
    async refreshProvider(providerId) { return usage(providerId, 1_000) },
  }
  const controller = new UsageLimitsClientController(rpc)

  const older = controller.loadRoster()
  const newer = controller.loadRoster()

  second.resolve([entry('new')])
  await newer
  first.resolve([entry('old')])
  await older

  assert.deepEqual(controller.getSnapshot().roster.map((item) => item.providerId), ['new'])
  assert.deepEqual(Object.keys(controller.getSnapshot().providers), ['new'])
})

test('a cached response from an older roster generation cannot recreate a removed provider', async () => {
  let roster: ProviderRosterEntry[] = [entry('fixture')]
  const cached = deferred<PublicProviderUsage[]>()
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() { return roster },
    async getProviders() { return cached.promise },
    async getProvider() { return null },
    async refreshProvider(providerId) { return usage(providerId, 1_000) },
  }
  const controller = new UsageLimitsClientController(rpc)

  await controller.loadRoster()
  const pendingCached = controller.loadCached()

  roster = []
  await controller.loadRoster()
  cached.resolve([usage('fixture', 1_000)])
  await pendingCached

  assert.deepEqual(controller.getSnapshot().roster, [])
  assert.deepEqual(controller.getSnapshot().providers, {})
})
