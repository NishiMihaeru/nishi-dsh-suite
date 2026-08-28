import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderDescriptor } from '../src/registry/descriptor.ts'
import { registerProvider, type SharedProviderDefaults } from '../src/runtime/registration.ts'

interface FixtureConfig extends SharedProviderDefaults {
  marker: string
}

const CONFIG: FixtureConfig = {
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 600_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
  marker: 'fixture',
}

function descriptor(refreshPolicy: { minRefreshIntervalMs: number; staleAfterMs: number }): ProviderDescriptor<FixtureConfig> {
  return {
    id: 'fixture',
    presentation: { id: 'fixture', displayName: 'Fixture', brandColor: '#123456' },
    executable: { id: 'fixture', defaultName: 'fixture-cli', envOverride: 'DSH_FIXTURE_EXECUTABLE' },
    usage: {
      refreshPolicy,
      create: () => ({
        async collect() {
          return {
            providerId: 'fixture',
            displayName: 'Fixture',
            status: 'UNAVAILABLE' as const,
            observedAtMs: 0,
            windows: [],
          }
        },
      }),
    },
  }
}

test('invalid provider usage policy is rejected before capability factory or registry mutation', async () => {
  let usageFactoryCalled = false
  let recordCalled = false
  const spec = descriptor({ minRefreshIntervalMs: -1, staleAfterMs: 5_000 })
  spec.usage!.create = (() => {
    usageFactoryCalled = true
    return { collect: async () => { throw new Error('not reached') } }
  }) as any

  const ctx = {
    nishiProviders: {
      record() {
        recordCalled = true
        return () => {}
      },
      invalidate() {},
    },
  }

  await assert.rejects(
    () => registerProvider(ctx as any, spec, CONFIG),
    /fixture: usage\.refreshPolicy\.minRefreshIntervalMs must be a non-negative safe integer number/,
  )
  assert.equal(usageFactoryCalled, false)
  assert.equal(recordCalled, false)
})

test('valid provider usage policy is detached and passed through the registry contract', async () => {
  const refreshPolicy = { minRefreshIntervalMs: 1_000, staleAfterMs: 5_000 }
  const spec = descriptor(refreshPolicy)
  let recordedPolicy: unknown

  const ctx = {
    nishiProviders: {
      record(entry: any) {
        recordedPolicy = entry.usage?.refreshPolicy
        return () => {}
      },
      invalidate() {},
    },
    effect(setup: () => () => void) {
      return setup()
    },
  }

  await registerProvider(ctx as any, spec, CONFIG)

  assert.deepEqual(recordedPolicy, refreshPolicy)
  assert.notEqual(recordedPolicy, refreshPolicy, 'registry-visible policy must be a detached validated copy')
})
