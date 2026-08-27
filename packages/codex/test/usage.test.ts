import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexRateLimitsSourceError, CodexUsageCollector } from '../src/usage.ts'

test('recognized Codex source failures become safe non-active snapshots', async () => {
  for (const [code, expected] of [['LOGIN_REQUIRED', 'LOGIN_REQUIRED'], ['UNAVAILABLE', 'UNAVAILABLE']] as const) {
    const snapshot = await new CodexUsageCollector({
      async read() { throw new CodexRateLimitsSourceError('raw credential path must not escape', code) },
    }).collect(1234)

    assert.equal(snapshot.status, expected)
    assert.equal(snapshot.providerId, 'codex')
    assert.deepEqual(snapshot.windows, [])
    assert.doesNotMatch(JSON.stringify(snapshot), /credential path/)
  }
})

test('an unknown Codex failure collapses to ERROR without vendor stderr', async () => {
  const snapshot = await new CodexUsageCollector({
    async read() { throw new Error('codex secret stderr') },
  }).collect(1)

  assert.equal(snapshot.status, 'ERROR')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /secret stderr/)
})
