import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { UsageLimitsHostService } from '../src/index.ts'
import { NishiProvidersService } from '../src/registry/service.ts'

async function fixture() {
  const ctx = new Context()
  await ctx.plugin(NishiProvidersService)
  const host = new UsageLimitsHostService(ctx, { clock: () => 1_234 })
  return { ctx, host }
}

function recordUsageLessProvider(ctx: Context, id = 'fixture') {
  return ctx.nishiProviders.record({
    id,
    presentation: {
      id,
      displayName: 'Fixture Provider',
      brandColor: '#123456',
    },
    routes: [],
    descriptor: {
      id,
      presentation: {
        id,
        displayName: 'Fixture Provider',
        brandColor: '#123456',
      },
      executable: {
        id,
        defaultName: 'fixture-cli',
        envOverride: 'DSH_FIXTURE_EXECUTABLE',
      },
    } as any,
  })
}

test('a registered provider without usage capability still appears in the usage roster', async () => {
  const { ctx, host } = await fixture()
  recordUsageLessProvider(ctx)

  assert.deepEqual(host.getRosterPublic(), [{
    providerId: 'fixture',
    presentation: {
      id: 'fixture',
      displayName: 'Fixture Provider',
      brandColor: '#123456',
    },
  }])
})

test('a provider without usage capability projects an honest UNSUPPORTED public state', async () => {
  const { ctx, host } = await fixture()
  recordUsageLessProvider(ctx)

  const expected = {
    providerId: 'fixture',
    displayName: 'Fixture Provider',
    status: 'UNSUPPORTED',
    observedAtMs: 1_234,
    freshness: 'UNKNOWN',
    windows: [],
  }

  assert.deepEqual(host.getCachedProviderPublic('fixture'), expected)
  assert.deepEqual(host.getCachedProvidersPublic(), [expected])
  assert.deepEqual(await host.refreshProviderPublic('fixture', { force: true }), expected)
})

test('usage capability absence does not make a live provider look unregistered', async () => {
  const { ctx, host } = await fixture()
  const withdraw = recordUsageLessProvider(ctx)

  assert.equal(host.isRegisteredProvider('fixture'), true)
  assert.equal(host.isRegisteredProvider(' fixture '), false)

  withdraw()
  assert.equal(host.isRegisteredProvider('fixture'), false)
  assert.deepEqual(host.getRosterPublic(), [])
  assert.deepEqual(host.getCachedProvidersPublic(), [])
})

test('invalidating a provider without usage capability is a safe no-op', async () => {
  const { ctx, host } = await fixture()
  recordUsageLessProvider(ctx)

  assert.doesNotThrow(() => host.invalidateProvider('fixture'))
})

test('refreshing an unknown provider still fails instead of manufacturing an unsupported row', async () => {
  const { host } = await fixture()

  await assert.rejects(
    () => host.refreshProviderPublic('missing'),
    /Provider "missing" is not registered/,
  )
})
