import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderUsageSnapshot } from '../src/usage/contract.ts'
import { UsageLimitsService } from '../src/usage/service.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function snapshot(displayName: string, observedAtMs: number): ProviderUsageSnapshot {
  return {
    providerId: 'fixture',
    displayName,
    status: 'AVAILABLE',
    observedAtMs,
    windows: [],
  }
}

const POLICY = {
  minRefreshIntervalMs: 0,
  staleAfterMs: 5_000,
} as const

test('a withdrawn usage generation cannot overwrite or clear the replacement generation', async () => {
  const observedAtMs = 1_000
  const firstGate = deferred<ProviderUsageSnapshot>()
  const secondGate = deferred<ProviderUsageSnapshot>()
  let firstCollectCalls = 0
  let secondCollectCalls = 0

  const service = new UsageLimitsService([], () => observedAtMs)
  const withdrawFirst = service.register({
    providerId: 'fixture',
    policy: POLICY,
    collector: {
      collect(sampledAtMs) {
        firstCollectCalls += 1
        assert.equal(sampledAtMs, observedAtMs)
        return firstGate.promise
      },
    },
  })

  const firstRefresh = service.refreshProvider('fixture', { force: true })
  const firstRefreshRejected = assert.rejects(
    firstRefresh,
    /registration changed during refresh/,
  )
  assert.equal(firstCollectCalls, 1)

  withdrawFirst()

  service.register({
    providerId: 'fixture',
    policy: POLICY,
    collector: {
      collect(sampledAtMs) {
        secondCollectCalls += 1
        assert.equal(sampledAtMs, observedAtMs)
        return secondGate.promise
      },
    },
  })

  const secondRefresh = service.refreshProvider('fixture', { force: true })
  assert.equal(secondCollectCalls, 1)

  // Finish the old generation while the replacement refresh is still in
  // flight. The old result must neither enter the cache nor remove the new
  // generation's in-flight de-duplication entry.
  firstGate.resolve(snapshot('OLD GENERATION', observedAtMs))
  await firstRefreshRejected

  const secondJoin = service.refreshProvider('fixture', { force: true })
  assert.equal(
    secondCollectCalls,
    1,
    'the stale refresh finally block must not delete the replacement in-flight entry',
  )

  secondGate.resolve(snapshot('NEW GENERATION', observedAtMs))
  const [secondResult, joinedResult] = await Promise.all([secondRefresh, secondJoin])

  assert.equal(secondResult.displayName, 'NEW GENERATION')
  assert.deepEqual(joinedResult, secondResult)
  assert.equal(service.getCachedSnapshot('fixture')?.displayName, 'NEW GENERATION')
})
