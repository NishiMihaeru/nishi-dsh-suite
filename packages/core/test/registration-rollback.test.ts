import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderDescriptor } from '../src/registry/descriptor.ts'
import { registerProvider, type SharedProviderDefaults } from '../src/runtime/registration.ts'

interface FixtureConfig extends SharedProviderDefaults {
  readonly marker: string
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

interface FakeOptions {
  throwOnRecord?: boolean
  throwOnEffect?: boolean
  throwOnAdapterRegistration?: boolean
  throwOnAdapterDispose?: boolean
  throwOnRegistryForget?: boolean
}

function fakeContext(options: FakeOptions = {}) {
  const events: string[] = []
  const activeProviders = new Set<string>()
  const activeAdapters = new Set<object>()
  const effects: Array<() => void | Promise<void>> = []

  const ctx = {
    nishiProviders: {
      record(entry: { id: string }) {
        events.push('record')
        if (options.throwOnRecord) throw new Error('record failed')
        activeProviders.add(entry.id)
        let forgotten = false
        return () => {
          if (forgotten) return
          forgotten = true
          events.push('forget')
          activeProviders.delete(entry.id)
          if (options.throwOnRegistryForget) throw new Error('forget failed')
        }
      },
      invalidate() {},
    },
    effect(setup: () => () => void | Promise<void>) {
      events.push('effect')
      if (options.throwOnEffect) throw new Error('effect failed')
      const teardown = setup()
      let disposed = false
      const dispose = async () => {
        if (disposed) return
        disposed = true
        await teardown()
      }
      effects.push(dispose)
      return dispose
    },
    llm: {
      registerAdapter(_routes: string[], _adapter: unknown) {
        events.push('model-register')
        if (options.throwOnAdapterRegistration) throw new Error('adapter registration failed')
        const token = {}
        activeAdapters.add(token)
        let disposed = false
        const dispose = () => {
          if (disposed) return
          disposed = true
          events.push('model-dispose')
          activeAdapters.delete(token)
          if (options.throwOnAdapterDispose) throw new Error('adapter dispose failed')
        }
        // Real DSH registerAdapter() is itself fiber-owned. Keep the fake's
        // successful registration in the same disposal stack so the success
        // test can prove normal unload order too.
        effects.push(dispose)
        return dispose
      },
    },
  }

  return {
    ctx: ctx as any,
    events,
    activeProviders,
    activeAdapters,
    async disposeAll() {
      for (const dispose of [...effects].reverse()) await dispose()
    },
  }
}

function descriptor(
  extras: Partial<ProviderDescriptor<FixtureConfig>> = {},
): ProviderDescriptor<FixtureConfig> {
  return {
    id: 'fixture',
    presentation: { id: 'fixture', displayName: 'Fixture', brandColor: '#123456' },
    executable: { id: 'fixture', defaultName: 'fixture-cli', envOverride: 'DSH_FIXTURE_EXECUTABLE' },
    model: {
      routes: ['fixture-model'],
      create: () => ({ name: 'fixture-adapter' } as any),
    },
    ...extras,
  }
}

function assertNoCoreState(fixture: ReturnType<typeof fakeContext>) {
  assert.deepEqual([...fixture.activeProviders], [], 'no registry entry may survive a rejected registration')
  assert.equal(fixture.activeAdapters.size, 0, 'no LLM adapter may survive a rejected registration')
}

test('a model factory failure rolls back the registry entry before rejection escapes', async () => {
  const fixture = fakeContext()
  const spec = descriptor({
    model: {
      routes: ['fixture-model'],
      create: () => {
        fixture.events.push('model-create')
        throw new Error('model create failed')
      },
    },
    install: () => fixture.events.push('install'),
  })

  await assert.rejects(() => registerProvider(fixture.ctx, spec, CONFIG), /model create failed/)

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events, ['record', 'effect', 'model-create', 'forget'])
})

test('an adapter registration failure rolls back the registry and never runs install', async () => {
  const fixture = fakeContext({ throwOnAdapterRegistration: true })
  const spec = descriptor({
    model: {
      routes: ['fixture-model'],
      create: () => {
        fixture.events.push('model-create')
        return {} as any
      },
    },
    install: () => fixture.events.push('install'),
  })

  await assert.rejects(() => registerProvider(fixture.ctx, spec, CONFIG), /adapter registration failed/)

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events, ['record', 'effect', 'model-create', 'model-register', 'forget'])
})

test('a synchronous install failure disposes the adapter before withdrawing the registry entry', async () => {
  const fixture = fakeContext()
  const spec = descriptor({
    install: () => {
      fixture.events.push('install')
      throw new Error('install failed')
    },
  })

  await assert.rejects(() => registerProvider(fixture.ctx, spec, CONFIG), /install failed/)

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events, [
    'record',
    'effect',
    'model-register',
    'install',
    'model-dispose',
    'forget',
  ])
})

test('an asynchronous install rejection gets the same complete rollback', async () => {
  const fixture = fakeContext()
  const spec = descriptor({
    async install() {
      fixture.events.push('install')
      await Promise.resolve()
      throw new Error('async install failed')
    },
  })

  await assert.rejects(() => registerProvider(fixture.ctx, spec, CONFIG), /async install failed/)

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events.slice(-2), ['model-dispose', 'forget'])
})

test('a registry-effect registration failure directly withdraws the already-recorded entry', async () => {
  const fixture = fakeContext({ throwOnEffect: true })

  await assert.rejects(() => registerProvider(fixture.ctx, descriptor(), CONFIG), /effect failed/)

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events, ['record', 'effect', 'forget'])
})

test('capability factory failure before registry mutation leaves no core-owned state', async () => {
  const fixture = fakeContext()
  const spec = descriptor({
    webSearch: {
      create: () => {
        fixture.events.push('search-create')
        return {} as any
      },
    },
    usage: {
      create: () => {
        fixture.events.push('usage-create')
        throw new Error('usage create failed')
      },
    },
  })

  await assert.rejects(() => registerProvider(fixture.ctx, spec, CONFIG), /usage create failed/)

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events, ['search-create', 'usage-create'])
})

test('rollback continues to withdraw the registry even when adapter disposal itself throws', async () => {
  const fixture = fakeContext({ throwOnAdapterDispose: true })
  const spec = descriptor({
    install: () => {
      fixture.events.push('install')
      throw new Error('install failed')
    },
  })

  const error = await assert.rejects(
    () => registerProvider(fixture.ctx, spec, CONFIG),
    AggregateError,
  )

  assertNoCoreState(fixture)
  assert.match((error as AggregateError).message, /rollback did not complete cleanly/)
  assert.deepEqual(fixture.events.slice(-2), ['model-dispose', 'forget'])
})

test('successful registration remains fiber-owned and unloads adapter before registry', async () => {
  const fixture = fakeContext()

  await registerProvider(fixture.ctx, descriptor(), CONFIG)

  assert.deepEqual([...fixture.activeProviders], ['fixture'])
  assert.equal(fixture.activeAdapters.size, 1)

  await fixture.disposeAll()

  assertNoCoreState(fixture)
  assert.deepEqual(fixture.events.slice(-2), ['model-dispose', 'forget'])
})
