import assert from 'node:assert/strict'
import test from 'node:test'
import type { PublicProviderUsage } from 'nishi-dsh-usage-limits'
import {
  computeLowestRemainingPercent,
  extractBucketWindows,
  extractProviderRings,
  formatPercent,
  sortWindows,
} from '../src/client/view-model.js'

const usage: PublicProviderUsage = {
  providerId: 'antigravity',
  displayName: 'Antigravity',
  status: 'AVAILABLE',
  observedAtMs: 1_000,
  staleAtMs: 2_000,
  freshness: 'FRESH',
  windows: [
    {
      id: 'model-fast',
      label: 'Model fast',
      kind: 'SHORT',
      usedPercent: 99,
      remainingPercent: 1,
      scope: { kind: 'MODEL', id: 'fast' },
    },
    {
      id: 'provider-weekly',
      label: 'Weekly',
      kind: 'WEEKLY',
      usedPercent: 65,
      remainingPercent: 35,
      scope: { kind: 'PROVIDER' },
    },
    {
      id: 'provider-short',
      label: 'Short',
      kind: 'SHORT',
      usedPercent: 20,
      remainingPercent: 80,
      scope: { kind: 'PROVIDER' },
    },
    {
      id: 'bucket-a',
      label: 'Bucket A',
      kind: 'OTHER',
      usedPercent: 50,
      remainingPercent: 50,
      scope: { kind: 'BUCKET', id: 'a' },
    },
  ],
}

test('lowest remaining percent only considers provider-scoped windows', () => {
  assert.equal(computeLowestRemainingPercent([usage]), 35)
})

test('provider rings select weekly and short provider windows', () => {
  const rings = extractProviderRings(usage)
  assert.equal(rings.weeklyPercent, 65)
  assert.equal(rings.shortPercent, 20)
  assert.equal(rings.weeklyWindow?.id, 'provider-weekly')
  assert.equal(rings.shortWindow?.id, 'provider-short')
})

test('bucket extraction and sorting preserve scope semantics', () => {
  assert.deepEqual(extractBucketWindows(usage).map((window) => window.id), ['bucket-a'])
  assert.deepEqual(
    sortWindows(usage.windows).map((window) => window.id),
    ['provider-short', 'provider-weekly', 'model-fast', 'bucket-a'],
  )
})

test('percent formatting keeps unavailable values explicit', () => {
  assert.equal(formatPercent(undefined), '—')
  assert.equal(formatPercent(Number.NaN), '—')
  assert.equal(formatPercent(12.6), '13%')
})
