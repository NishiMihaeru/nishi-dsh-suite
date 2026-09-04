import assert from 'node:assert/strict'
import test from 'node:test'
import { GrokUsageCollector, GrokUsageSourceError, normalizeGrokUsage } from '../src/usage.ts'

const OPEN_START = '2026-09-03T16:13:00.760610+00:00'
const OPEN_END = '2026-09-10T16:13:00.760610+00:00'

test('recognized Grok source failures become safe non-active snapshots', async () => {
  const snapshot = await new GrokUsageCollector({
    async read() { throw new GrokUsageSourceError('grok raw failure must not escape', 'UNAVAILABLE') },
  }).collect(1234)

  assert.equal(snapshot.status, 'UNAVAILABLE')
  assert.equal(snapshot.providerId, 'grok')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /raw failure/)
})

test('an unknown Grok failure collapses to ERROR without vendor stderr', async () => {
  const snapshot = await new GrokUsageCollector({
    async read() { throw new Error('grok secret stderr') },
  }).collect(1)

  assert.equal(snapshot.status, 'ERROR')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /secret stderr/)
})

test('a weekly credit window becomes one PROVIDER-scoped snapshot', () => {
  const snapshot = normalizeGrokUsage({
    kind: 'NUMERIC_USAGE_AVAILABLE',
    windows: [{
      id: 'weekly',
      windowKind: 'WEEKLY',
      label: 'Weekly',
      usedPercent: 64,
      resetsAtMs: Date.parse(OPEN_END),
      windowDurationMs: Date.parse(OPEN_END) - Date.parse(OPEN_START),
      tierLabel: 'SuperGrok',
    }],
  }, 1_700_000_000_000)

  assert.equal(snapshot.status, 'AVAILABLE')
  assert.equal(snapshot.windows.length, 1)
  const [weekly] = snapshot.windows
  assert.equal(weekly.id, 'grok-weekly')
  assert.equal(weekly.kind, 'WEEKLY')
  assert.equal(weekly.label, 'Weekly')
  assert.equal(weekly.usedPercent, 64)
  assert.equal(weekly.scope?.kind, 'PROVIDER')
  assert.equal(weekly.scope?.label, 'SuperGrok')
  assert.equal(weekly.resetsAtMs, Date.parse(OPEN_END))
})

test('a window without a tier label does not invent one', () => {
  const snapshot = normalizeGrokUsage({
    kind: 'NUMERIC_USAGE_AVAILABLE',
    windows: [{ id: 'weekly', windowKind: 'WEEKLY', label: 'Weekly', usedPercent: 0 }],
  }, 1)

  assert.equal(snapshot.windows[0]?.scope?.kind, 'PROVIDER')
  assert.equal(snapshot.windows[0]?.scope?.label, undefined)
})
