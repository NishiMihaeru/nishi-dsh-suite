import assert from 'node:assert/strict'
import test from 'node:test'
import type { PublicProviderUsage } from '../src/usage/index.js'
import {
  createUsageLimitsRpcHandler,
  USAGE_LIMITS_GET_PROVIDER_ENDPOINT,
  USAGE_LIMITS_GET_ROSTER_ENDPOINT,
  USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT,
  type UsageLimitsRpcHost,
} from '../src/host/rpc.js'

const signal = new AbortController().signal

const usage: PublicProviderUsage = {
  providerId: 'codex',
  displayName: 'Codex',
  status: 'AVAILABLE',
  observedAtMs: 1_000,
  staleAtMs: 2_000,
  freshness: 'FRESH',
  windows: [
    {
      id: 'weekly',
      label: 'Weekly',
      kind: 'WEEKLY',
      usedPercent: 25,
      remainingPercent: 75,
      scope: { kind: 'PROVIDER' },
    },
  ],
}

function host(overrides: Partial<UsageLimitsRpcHost> = {}): UsageLimitsRpcHost {
  return {
    getRosterPublic: () => [{
      providerId: 'codex',
      presentation: { id: 'codex', displayName: 'Codex', brandColor: '#10A37F', iconPath: 'M0 0h1v1H0z' },
    }],
    getCachedProvidersPublic: () => [usage],
    getCachedProviderPublic: (providerId) => providerId === 'codex' ? usage : undefined,
    refreshProviderPublic: async () => usage,
    isRegisteredProvider: (providerId) => providerId === 'codex',
    ...overrides,
  }
}

test('get-provider trims and validates provider id before returning the public dto', async () => {
  const handler = createUsageLimitsRpcHandler(host())
  const result = await handler(USAGE_LIMITS_GET_PROVIDER_ENDPOINT, { providerId: ' codex ' }, signal)

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value, usage)
})

test('usage rpc rejects unexpected request fields', async () => {
  let called = false
  const handler = createUsageLimitsRpcHandler(host({
    getCachedProviderPublic: () => {
      called = true
      return usage
    },
  }))

  const result = await handler(
    USAGE_LIMITS_GET_PROVIDER_ENDPOINT,
    { providerId: 'codex', unexpected: true },
    signal,
  )

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'bad-request')
  assert.equal(result.error.message, 'Invalid usage limits request.')
  assert.equal(called, false)
})

test('usage rpc reduces host failures to a generic internal error', async () => {
  const secret = 'token-super-secret-value'
  const handler = createUsageLimitsRpcHandler(host({
    refreshProviderPublic: async () => {
      throw new Error(secret)
    },
  }))

  const result = await handler(
    USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT,
    { providerId: 'codex', force: true },
    signal,
  )

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'internal')
  assert.equal(result.error.message, 'Usage limits operation failed.')
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('get-roster projects only the presentation fields this contract defines', async () => {
  const handler = createUsageLimitsRpcHandler(host({
    getRosterPublic: () => [{
      providerId: 'codex',
      presentation: {
        id: 'codex',
        displayName: 'Codex',
        brandColor: '#10A37F',
        bucketsAsPools: false,
        // A provider could put anything on its descriptor; the browser must
        // only ever receive the declared shape.
        onclick: 'alert(1)',
        nested: { secret: true },
      } as any,
    }],
  }))

  const result = await handler(USAGE_LIMITS_GET_ROSTER_ENDPOINT, {}, signal)

  assert.equal(result.ok, true)
  assert.deepEqual(result.value, [{
    providerId: 'codex',
    presentation: { id: 'codex', displayName: 'Codex', brandColor: '#10A37F', bucketsAsPools: false },
  }])
})

test('get-roster rejects a request with unexpected fields', async () => {
  const handler = createUsageLimitsRpcHandler(host())
  const result = await handler(USAGE_LIMITS_GET_ROSTER_ENDPOINT, { providerId: 'codex' }, signal)
  assert.equal(result.ok, false)
})

test('an empty roster is a legal answer, not an error', async () => {
  const handler = createUsageLimitsRpcHandler(host({ getRosterPublic: () => [] }))
  const result = await handler(USAGE_LIMITS_GET_ROSTER_ENDPOINT, {}, signal)
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, [])
})
