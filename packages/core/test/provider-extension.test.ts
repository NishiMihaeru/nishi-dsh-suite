import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { composeUsageLimitsHost } from '../src/host/composition.ts'
import { NishiProvidersService } from '../src/registry/service.ts'
import type { PrimarySearchBackend } from '../src/web-search/types.ts'

const NEBULA_ID = 'nebula'
const NEBULA_ROUTE = 'nebula-chat'

async function coreRegistryContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(NishiProvidersService)
  return ctx
}

test('an unfamiliar fourth provider flows through registry, search routing, usage composition and withdrawal', async () => {
  const ctx = await coreRegistryContext()
  const clock = () => 1_000
  const { service, facade } = composeUsageLimitsHost(
    ctx,
    { defaultRefreshPolicy: { minRefreshIntervalMs: 0, staleAfterMs: 5_000 } },
    clock,
  )

  let collectCalls = 0
  const searchBackend = {
    async search() {
      return { results: [] }
    },
  } as unknown as PrimarySearchBackend

  const descriptor = {
    id: NEBULA_ID,
    presentation: { id: NEBULA_ID, displayName: 'Nebula CLI', brandColor: '#445566' },
    executable: { id: NEBULA_ID, defaultName: 'nebula', envOverride: 'DSH_NEBULA_EXECUTABLE' },
  } as any

  const forget = ctx.nishiProviders.record({
    id: NEBULA_ID,
    presentation: descriptor.presentation,
    routes: [NEBULA_ROUTE],
    descriptor,
    webSearch: searchBackend,
    usage: {
      collector: {
        async collect(observedAtMs: number) {
          collectCalls += 1
          return {
            providerId: NEBULA_ID,
            displayName: 'Nebula CLI',
            status: 'AVAILABLE' as const,
            observedAtMs,
            windows: [],
          }
        },
      },
      refreshPolicy: { minRefreshIntervalMs: 0, staleAfterMs: 5_000 },
    },
  })

  assert.equal(ctx.nishiProviders.byId(NEBULA_ID)?.id, NEBULA_ID)
  assert.equal(ctx.nishiProviders.byRoute(NEBULA_ROUTE)?.id, NEBULA_ID)
  assert.equal(ctx.nishiProviders.byRoute(NEBULA_ROUTE)?.webSearch, searchBackend)
  assert.deepEqual(service.getRegisteredProviderIds(), [NEBULA_ID])

  const usage = await facade.refreshProvider(NEBULA_ID, { force: true })
  assert.equal(collectCalls, 1)
  assert.equal(usage.providerId, NEBULA_ID)
  assert.equal(usage.displayName, 'Nebula CLI')
  assert.equal(usage.status, 'AVAILABLE')

  forget()

  assert.equal(ctx.nishiProviders.byId(NEBULA_ID), undefined)
  assert.equal(ctx.nishiProviders.byRoute(NEBULA_ROUTE), undefined)
  assert.deepEqual(service.getRegisteredProviderIds(), [])
})
