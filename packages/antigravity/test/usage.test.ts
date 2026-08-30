import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravityUsageCollector, AntigravityUsageSourceError, normalizeAntigravityCapability } from '../src/usage.ts'

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

test('one vendor pool with two cadences becomes one group, not two', () => {
  // The vendor buckets per pool AND per cadence, so a single pool arrives as
  // two windows with different bucket ids. They must share one scope id, or
  // the browser lists the same pool twice — once per window.
  const snapshot = normalizeAntigravityCapability({
    kind: 'NUMERIC_USAGE_AVAILABLE',
    windows: [
      { label: 'Gemini Models 5h', scope: 'BUCKET', scopeId: 'legacy-gemini-session', windowKind: 'SHORT', usedPercent: 10 },
      { label: 'Gemini Models Weekly', scope: 'BUCKET', scopeId: 'gemini-weekly', windowKind: 'WEEKLY', usedPercent: 20 },
      { label: 'Claude / GPT Weekly', scope: 'BUCKET', scopeId: 'claude-gpt-weekly', windowKind: 'WEEKLY', usedPercent: 30 },
    ],
  }, 1_700_000_000_000)

  const scopeIds = snapshot.windows.map(w => w.scope?.id)
  assert.equal(scopeIds[0], scopeIds[1], 'both Gemini cadences share one pool identity')
  assert.notEqual(scopeIds[1], scopeIds[2], 'a different pool keeps a different identity')

  // Windows themselves stay distinct — one per cadence.
  assert.equal(new Set(snapshot.windows.map(w => w.id)).size, 3)
})
