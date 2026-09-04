import assert from 'node:assert/strict'
import test from 'node:test'
import {
  startUsageAutoRefresh,
  USAGE_AUTO_REFRESH_INTERVAL_MS,
  type UsageAutoRefreshScheduler,
} from '../src/client/auto-refresh.ts'

class FakeScheduler implements UsageAutoRefreshScheduler {
  paused = false
  intervalMs?: number
  cleared = false
  unsubscribed = false
  private intervalCallback?: () => void
  private resumeCallback?: () => void

  setInterval(callback: () => void, intervalMs: number): unknown {
    this.intervalCallback = callback
    this.intervalMs = intervalMs
    return 123
  }

  clearInterval(handle: unknown): void {
    assert.equal(handle, 123)
    this.cleared = true
  }

  isPaused(): boolean {
    return this.paused
  }

  subscribeResume(callback: () => void): () => void {
    this.resumeCallback = callback
    return () => { this.unsubscribed = true }
  }

  tick(): void {
    this.intervalCallback?.()
  }

  resume(): void {
    this.resumeCallback?.()
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test('auto refresh pauses, resumes, avoids overlap, and cleans up', async () => {
  const scheduler = new FakeScheduler()
  const pending: Array<ReturnType<typeof deferred>> = []
  let refreshCalls = 0
  const stop = startUsageAutoRefresh(() => {
    refreshCalls++
    const next = deferred()
    pending.push(next)
    return next.promise
  }, scheduler)

  assert.equal(scheduler.intervalMs, USAGE_AUTO_REFRESH_INTERVAL_MS)

  scheduler.paused = true
  scheduler.tick()
  assert.equal(refreshCalls, 0)

  scheduler.paused = false
  scheduler.resume()
  scheduler.tick()
  assert.equal(refreshCalls, 1, 'a second trigger must not overlap the active refresh')

  pending[0]!.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  scheduler.tick()
  assert.equal(refreshCalls, 2)

  stop()
  assert.equal(scheduler.cleared, true)
  assert.equal(scheduler.unsubscribed, true)

  pending[1]!.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  scheduler.tick()
  scheduler.resume()
  assert.equal(refreshCalls, 2, 'cleanup must prevent future refreshes')
})
