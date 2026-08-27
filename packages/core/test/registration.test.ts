import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  registerProvider,
  resolveSharedProviderConfig,
  type ProviderDescriptor,
  type SharedProviderConfig,
  type SharedProviderDefaults,
} from '../src/runtime/registration.ts'

const DEFAULTS: SharedProviderDefaults = {
  env: { FROM: 'defaults' },
  modelCacheMs: 30_000,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 600_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
}

// --- resolveSharedProviderConfig ---------------------------------------

test('resolveSharedProviderConfig merges raw fields over defaults, field by field', () => {
  const resolved = resolveSharedProviderConfig('fixture', {
    catalogTimeoutMs: 5_000,
  }, DEFAULTS)
  assert.deepEqual(resolved, {
    env: { FROM: 'defaults' },
    modelCacheMs: 30_000,
    catalogTimeoutMs: 5_000,
    turnTimeoutMs: 600_000,
    disposeGraceMs: 3_000,
    stderrMaxBytes: 16_384,
  })
})

test('resolveSharedProviderConfig falls back to every default when raw is empty', () => {
  const resolved = resolveSharedProviderConfig('fixture', {}, DEFAULTS)
  assert.deepEqual(resolved, DEFAULTS)
})

test('resolveSharedProviderConfig passes env through unvalidated', () => {
  const env = { CUSTOM: 'value' }
  const resolved = resolveSharedProviderConfig('fixture', { env }, DEFAULTS)
  assert.equal(resolved.env, env)
})

test('resolveSharedProviderConfig rejects a negative modelCacheMs', () => {
  assert.throws(
    () => resolveSharedProviderConfig('fixture', { modelCacheMs: -1 }, DEFAULTS),
    /^Error: fixture: modelCacheMs must be non-negative and finite$/,
  )
})

test('resolveSharedProviderConfig rejects a non-finite modelCacheMs', () => {
  assert.throws(
    () => resolveSharedProviderConfig('fixture', { modelCacheMs: Infinity }, DEFAULTS),
    /^Error: fixture: modelCacheMs must be non-negative and finite$/,
  )
})

test('resolveSharedProviderConfig accepts a zero modelCacheMs (caching disabled)', () => {
  const resolved = resolveSharedProviderConfig('fixture', { modelCacheMs: 0 }, DEFAULTS)
  assert.equal(resolved.modelCacheMs, 0)
})

for (const field of ['catalogTimeoutMs', 'turnTimeoutMs', 'disposeGraceMs', 'stderrMaxBytes'] as const) {
  test(`resolveSharedProviderConfig rejects a non-positive ${field}`, () => {
    assert.throws(
      () => resolveSharedProviderConfig('fixture', { [field]: 0 } as SharedProviderConfig, DEFAULTS),
      new RegExp(`^Error: fixture: ${field} must be a positive finite number$`),
    )
  })

  test(`resolveSharedProviderConfig rejects a non-finite ${field}`, () => {
    assert.throws(
      () => resolveSharedProviderConfig('fixture', { [field]: NaN } as SharedProviderConfig, DEFAULTS),
      new RegExp(`^Error: fixture: ${field} must be a positive finite number$`),
    )
  })
}

for (const field of ['catalogTimeoutMs', 'turnTimeoutMs', 'disposeGraceMs'] as const) {
  test(`resolveSharedProviderConfig caps ${field} at MAX_TIMER_DELAY_MS`, () => {
    assert.throws(
      () => resolveSharedProviderConfig(
        'fixture',
        { [field]: MAX_TIMER_DELAY_MS + 1 } as SharedProviderConfig,
        DEFAULTS,
      ),
      new RegExp(`^Error: fixture: ${field} must be no greater than ${MAX_TIMER_DELAY_MS}$`),
    )
  })

  test(`resolveSharedProviderConfig accepts ${field} exactly at MAX_TIMER_DELAY_MS`, () => {
    const resolved = resolveSharedProviderConfig(
      'fixture',
      { [field]: MAX_TIMER_DELAY_MS } as SharedProviderConfig,
      DEFAULTS,
    )
    assert.equal(resolved[field], MAX_TIMER_DELAY_MS)
  })
}

test('resolveSharedProviderConfig does not cap stderrMaxBytes at MAX_TIMER_DELAY_MS', () => {
  const resolved = resolveSharedProviderConfig(
    'fixture',
    { stderrMaxBytes: MAX_TIMER_DELAY_MS + 1 },
    DEFAULTS,
  )
  assert.equal(resolved.stderrMaxBytes, MAX_TIMER_DELAY_MS + 1)
})

// --- registerProvider ----------------------------------------------------

interface FixtureConfig extends SharedProviderDefaults {
  readonly marker: string
}

function fakeContext() {
  const calls: string[] = []
  const adapters: { routes: string[]; adapter: unknown }[] = []
  const ctx = {
    subagents: {
      registerProvider() {
        throw new Error('delegation was removed in 0.1.0-rc.3: no provider may register a subagent provider')
      },
    },
    llm: {
      registerAdapter(routes: string[], adapter: unknown) {
        calls.push('model')
        adapters.push({ routes, adapter })
      },
    },
  }
  return { ctx: ctx as any, calls, adapters }
}

const FIXTURE_CONFIG: FixtureConfig = { ...DEFAULTS, marker: 'fixture' }

test('registerProvider registers the model, then runs install, in that order', async () => {
  const fixture = fakeContext()
  const seenByModel: unknown[] = []
  const seenByInstall: unknown[] = []
  const descriptor: ProviderDescriptor<FixtureConfig> = {
    id: 'fixture',
    executable: { id: 'fixture', defaultName: 'fixture-cli', envOverride: 'DSH_FIXTURE_EXECUTABLE' },
    model: {
      routes: ['fixture-model'],
      create(ctx, config) {
        seenByModel.push([ctx, config])
        fixture.calls.push('model-create')
        return { name: 'fixture-adapter' } as any
      },
    },
    async install(ctx, config) {
      seenByInstall.push([ctx, config])
      fixture.calls.push('install')
    },
  }

  await registerProvider(fixture.ctx, descriptor, FIXTURE_CONFIG)

  assert.deepEqual(fixture.calls, ['model-create', 'model', 'install'])
  assert.deepEqual(fixture.adapters, [{ routes: ['fixture-model'], adapter: { name: 'fixture-adapter' } }])
  assert.deepEqual(seenByModel, [[fixture.ctx, FIXTURE_CONFIG]])
  assert.deepEqual(seenByInstall, [[fixture.ctx, FIXTURE_CONFIG]])
})

test('registerProvider registers nothing on ctx.subagents — delegation left the contract', async () => {
  const fixture = fakeContext()
  const descriptor: ProviderDescriptor<FixtureConfig> = {
    id: 'fixture',
    executable: { id: 'fixture', defaultName: 'fixture-cli', envOverride: 'DSH_FIXTURE_EXECUTABLE' },
    model: { routes: ['fixture-model'], create: () => ({ name: 'fixture-adapter' } as any) },
  }

  await registerProvider(fixture.ctx, descriptor, FIXTURE_CONFIG)

  assert.equal(fixture.adapters.length, 1, 'the fake context throws if a subagent provider is registered')
})

test('registerProvider resolves cleanly when the descriptor has neither model nor install', async () => {
  const fixture = fakeContext()
  const descriptor: ProviderDescriptor<FixtureConfig> = {
    id: 'fixture',
    executable: { id: 'fixture', defaultName: 'fixture-cli', envOverride: 'DSH_FIXTURE_EXECUTABLE' },
  }

  await assert.doesNotReject(() => registerProvider(fixture.ctx, descriptor, FIXTURE_CONFIG))
  assert.equal(fixture.adapters.length, 0)
})

test('registerProvider awaits an async install before resolving', async () => {
  const fixture = fakeContext()
  let installFinished = false
  const descriptor: ProviderDescriptor<FixtureConfig> = {
    id: 'fixture',
    executable: { id: 'fixture', defaultName: 'fixture-cli', envOverride: 'DSH_FIXTURE_EXECUTABLE' },
    async install() {
      await new Promise(resolve => setTimeout(resolve, 0))
      installFinished = true
    },
  }

  await registerProvider(fixture.ctx, descriptor, FIXTURE_CONFIG)

  assert.equal(installFinished, true)
})
