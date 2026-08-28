import assert from 'node:assert/strict'
import test from 'node:test'
import { composeUsageLimitsHost } from '../src/host/composition.ts'

test('invalid default usage refresh policy fails before registry observers are touched', () => {
  const ctx = new Proxy({}, {
    get(_target, property) {
      throw new Error(`context service ${String(property)} must not be read`)
    },
  })

  assert.throws(
    () => composeUsageLimitsHost(ctx as any, {
      defaultRefreshPolicy: {
        minRefreshIntervalMs: -1,
        staleAfterMs: 5_000,
      },
    }),
    /usage limits defaultRefreshPolicy\.minRefreshIntervalMs must be a non-negative safe integer number/,
  )
})
