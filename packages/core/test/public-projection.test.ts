import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectProviderUsageForPublic,
  parsePublicProviderUsage,
  UsageContractError,
} from '../src/usage/index.js'

test('public projection strips internal collector/source metadata', () => {
  const projected = projectProviderUsageForPublic({
    providerId: 'codex',
    displayName: 'Codex',
    status: 'AVAILABLE',
    observedAtMs: 1000,
    staleAtMs: 2000,
    windows: [{
      id: 'primary',
      label: '5-hour',
      kind: 'SHORT',
      usedPercent: 37,
      resetsAtMs: 1500,
      scope: { kind: 'PROVIDER' },
    }],
    source: {
      kind: 'OFFICIAL_LOCAL_PROTOCOL',
      collectorId: 'secret-internal-collector-name',
      collectorVersion: '0.1.0',
      capabilityClass: 'SUPPORTED_OFFICIAL',
    },
  }, 1200)

  assert.equal(projected.freshness, 'FRESH')
  assert.equal(projected.windows[0]?.remainingPercent, 63)
  assert.equal('source' in (projected as any), false)
  assert.doesNotMatch(JSON.stringify(projected), /secret-internal-collector-name/)
})

test('public DTO rejects internal source metadata as an unknown field', () => {
  assert.throws(() => parsePublicProviderUsage({
    providerId: 'codex',
    displayName: 'Codex',
    status: 'AVAILABLE',
    observedAtMs: 1000,
    freshness: 'UNKNOWN',
    windows: [],
    source: { collectorId: 'must-not-cross-boundary' },
  }), UsageContractError)
})

test('public projection rejects windows without a proven used percentage', () => {
  assert.throws(() => projectProviderUsageForPublic({
    providerId: 'codex',
    displayName: 'Codex',
    status: 'AVAILABLE',
    observedAtMs: 1000,
    windows: [{ id: 'unknown', label: 'Unknown', kind: 'OTHER' }],
  }, 1000), /missing usedPercent/)
})
