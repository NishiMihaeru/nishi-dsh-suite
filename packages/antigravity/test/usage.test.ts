import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravityUsageCollector, AntigravityUsageSourceError } from '../src/usage.ts'

test('recognized Antigravity source failures become safe non-active snapshots', async () => {
  const snapshot = await new AntigravityUsageCollector({
    async read() { throw new AntigravityUsageSourceError('agy raw failure must not escape', 'UNSUPPORTED') },
  }).collect(1234)

  assert.equal(snapshot.status, 'UNSUPPORTED')
  assert.equal(snapshot.providerId, 'antigravity')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /raw failure/)
})

test('an unknown Antigravity failure collapses to ERROR without vendor stderr', async () => {
  const snapshot = await new AntigravityUsageCollector({
    async read() { throw new Error('agy secret stderr') },
  }).collect(1)

  assert.equal(snapshot.status, 'ERROR')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /secret stderr/)
})
