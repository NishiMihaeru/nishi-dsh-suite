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

test('a refreshProvider implementation that throws synchronously does not leave a stuck in-flight entry', async () => {
  // `UsageLimitsBrowserRpc` is an interface; nothing requires a real
  // implementation to defer its failure into a rejected promise the way the
  // shipped `UsageLimitsBrowserRpcClient` does. `doRefresh` must survive a
  // caller-supplied rpc whose method throws before ever returning a promise.
  let refreshCalls = 0
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() { return [entry('fixture')] },
    async getProviders() { return [] },
    async getProvider() { return null },
    refreshProvider(): Promise<PublicProviderUsage> {
      refreshCalls++
      throw new Error('synchronous rpc failure')
    },
  }
  const controller = new UsageLimitsClientController(rpc)

  await controller.loadRoster()
  await controller.refreshProvider('fixture')

  assert.equal(refreshCalls, 1)
  assert.equal(
    (controller as unknown as { inFlightRefreshes: Map<string, unknown> }).inFlightRefreshes.size,
    0,
    'a synchronous rpc throw must not leave a stale rejected-promise entry in the in-flight map',
  )

  // If the prior attempt left a stuck entry keyed to this roster generation,
  // this call would join that dead promise and never call the rpc again.
  await controller.refreshProvider('fixture')
  assert.equal(refreshCalls, 2, 'a later refresh in the same roster generation must make its own rpc call')
})

test('dispose() stops notifying subscribers and clears in-flight bookkeeping', async () => {
  const pending = deferred<PublicProviderUsage>()
  let refreshCalls = 0
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() { return [entry('fixture')] },
    async getProviders() { return [] },
    async getProvider() { return null },
    async refreshProvider() {
      refreshCalls++
      return pending.promise
    },
  }
  const controller = new UsageLimitsClientController(rpc)
  await controller.loadRoster()

  let notifications = 0
  controller.subscribe(() => { notifications++ })

  const inFlight = controller.refreshProvider('fixture')
  assert.ok(notifications > 0, 'starting a refresh notifies subscribers')

  controller.dispose()
  assert.equal(
    (controller as unknown as { inFlightRefreshes: Map<string, unknown> }).inFlightRefreshes.size,
    0,
    'dispose must clear in-flight bookkeeping',
  )

  const notificationsAtDispose = notifications
  pending.resolve(usage('fixture', 1_000))
  await inFlight

  assert.equal(notifications, notificationsAtDispose, 'no listener call may happen after dispose')
  assert.equal(refreshCalls, 1)
})

test('a subscriber that refreshes again during a synchronous rpc failure can still join the in-flight record', async () => {
  // The synchronous-throw path runs `catch` — and therefore `notify()` — while
  // the in-flight record is still published. A subscriber is free to refresh
  // from that notification, so the published record must already carry a real
  // promise to join rather than a placeholder filled in afterwards.
  let refreshCalls = 0
  const rpc: UsageLimitsBrowserRpc = {
    async getRoster() { return [entry('fixture')] },
    async getProviders() { return [] },
    async getProvider() { return null },
    refreshProvider(): Promise<PublicProviderUsage> {
      refreshCalls++
      throw new Error('synchronous rpc failure')
    },
  }
  const controller = new UsageLimitsClientController(rpc)
  await controller.loadRoster()

  // Refresh only from the failure notification: the earlier `loading` notify
  // happens before the record is published, which is a different path.
  let reentrant: Promise<void> | undefined
  controller.subscribe(() => {
    if (reentrant !== undefined) return
    if (controller.getSnapshot().providers.fixture?.status !== 'error') return
    reentrant = controller.refreshProvider('fixture')
  })

  await controller.refreshProvider('fixture')
  assert.ok(reentrant !== undefined, 'the failing refresh must have notified the subscriber')
  await reentrant
  assert.equal(
    (controller as unknown as { inFlightRefreshes: Map<string, unknown> }).inFlightRefreshes.size,
    0,
  )
  assert.equal(refreshCalls, 1, 'the re-entrant call joins the in-flight record instead of starting a second rpc call')
})
