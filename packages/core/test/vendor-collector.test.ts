import assert from 'node:assert/strict'
import test from 'node:test'
import { VendorUsageCollector, type VendorUsageCollectorSpec } from '../src/usage/collectors/vendor-collector.ts'

/**
 * The shared collector behaviour, tested without any provider: a source error
 * the provider recognizes becomes a safe non-active snapshot, and anything
 * else collapses to ERROR with no vendor text in it. Each provider covers its
 * own recognized codes in its own package.
 */
const SPEC: VendorUsageCollectorSpec<unknown> = {
  providerId: 'fixture',
  displayName: 'Fixture',
  sourceMetadata: () => ({
    kind: 'OFFICIAL_LOCAL_PROTOCOL',
    collectorId: 'fixture-usage',
    collectorVersion: '0.1.0',
    capabilityClass: 'SUPPORTED_OFFICIAL',
  }),
  sourceErrorCode: (error) =>
    error instanceof Error && error.message.startsWith('recognized:') ? 'LOGIN_REQUIRED' : undefined,
  normalize: (_payload, observedAtMs) => ({
    providerId: 'fixture',
    displayName: 'Fixture',
    status: 'AVAILABLE',
    observedAtMs,
    windows: [],
    source: SPEC.sourceMetadata(),
  }),
}

test('a recognized source error becomes a safe non-active snapshot', async () => {
  const snapshot = await new VendorUsageCollector({
    async read() { throw new Error('recognized: /home/user/.secret/credentials.json') },
  }, SPEC).collect(1234)

  assert.equal(snapshot.status, 'LOGIN_REQUIRED')
  assert.deepEqual(snapshot.windows, [])
  assert.equal(snapshot.observedAtMs, 1234)
  assert.doesNotMatch(JSON.stringify(snapshot), /credentials\.json/, 'vendor text must not reach a snapshot')
})

test('an unrecognized source error collapses to ERROR without vendor details', async () => {
  const snapshot = await new VendorUsageCollector({
    async read() { throw new Error('unexpected vendor stderr with a local path') },
  }, SPEC).collect(1)

  assert.equal(snapshot.status, 'ERROR')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /vendor stderr|local path/)
})

test('collect refuses a nonsensical observation timestamp', async () => {
  const collector = new VendorUsageCollector({ async read() { return {} } }, SPEC)
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(() => collector.collect(bad), /observedAtMs/)
  }
})
