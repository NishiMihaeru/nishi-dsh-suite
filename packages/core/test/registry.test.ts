import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { NishiProvidersService } from '../src/registry/service.ts'
import { MAX_PROVIDER_ID_LENGTH, MAX_PROVIDER_ROUTE_LENGTH } from '../src/registry/identity.ts'

/**
 * A real cordis context, mounted the way the core mounts it: the service is
 * reached through `ctx.nishiProviders`, which is a Proxy, so this also covers
 * the private-field trap plain construction would hide.
 */
async function service(): Promise<NishiProvidersService> {
  const ctx = new Context()
  await ctx.plugin(NishiProvidersService)
  return ctx.nishiProviders
}

function entry(id: string, routes: string[]) {
  return { id, routes, descriptor: { id, executable: { id, defaultName: id, envOverride: 'X' } } as any }
}

test('a recorded provider is resolvable by id and by every route it serves', async () => {
  const registry = await service()
  registry.record(entry('fixture', ['fixture-app-server', 'fixture-legacy']))

  assert.equal(registry.byId('fixture')?.id, 'fixture')
  assert.equal(registry.byRoute('fixture-app-server')?.id, 'fixture')
  assert.equal(registry.byRoute('fixture-legacy')?.id, 'fixture')
  assert.equal(registry.byRoute('unknown'), undefined)
  assert.deepEqual(registry.all().map((provider) => provider.id), ['fixture'])
})

test('a duplicate id is refused', async () => {
  const registry = await service()
  registry.record(entry('fixture', ['fixture-app-server']))
  assert.throws(() => registry.record(entry('fixture', ['other-route'])), /already registered/)
})

test('a duplicate route is refused, naming the provider that already owns it', async () => {
  const registry = await service()
  registry.record(entry('first', ['shared-route']))
  assert.throws(
    () => registry.record(entry('second', ['shared-route'])),
    /route "shared-route" is already served by provider "first"/,
  )
  assert.equal(registry.byId('second'), undefined, 'a refused registration leaves nothing behind')
})

test('duplicate routes inside one provider are refused before state changes', async () => {
  const registry = await service()
  assert.throws(
    () => registry.record(entry('fixture', ['same-route', 'same-route'])),
    /declares duplicate route "same-route"/,
  )
  assert.equal(registry.byId('fixture'), undefined)
  assert.equal(registry.byRoute('same-route'), undefined)
})

test('a usage-only provider declaring no route is registered and serves none', async () => {
  const registry = await service()
  registry.record(entry('usage-only', []))
  assert.equal(registry.byId('usage-only')?.id, 'usage-only')
  assert.deepEqual(registry.all().map((provider) => provider.id), ['usage-only'])
})

test('withdrawing a registration removes its id and its routes', async () => {
  const registry = await service()
  const forget = registry.record(entry('fixture', ['fixture-app-server']))
  forget()
  assert.equal(registry.byId('fixture'), undefined)
  assert.equal(registry.byRoute('fixture-app-server'), undefined)
  assert.deepEqual(registry.all(), [])
  forget()
  assert.deepEqual(registry.all(), [], 'withdrawing twice is a no-op')
})

test('withdrawing a replaced entry does not remove the replacement', async () => {
  const registry = await service()
  const forget = registry.record(entry('fixture', ['fixture-app-server']))
  forget()
  registry.record(entry('fixture', ['fixture-app-server']))
  forget()
  assert.equal(registry.byId('fixture')?.id, 'fixture', 'the stale disposer must not evict the live entry')
})

test('a listener sees every registration change until it unsubscribes', async () => {
  const registry = await service()
  let changes = 0
  const unsubscribe = registry.onChange(() => { changes++ })

  const forget = registry.record(entry('first', ['first-route']))
  assert.equal(changes, 1)
  forget()
  assert.equal(changes, 2)

  unsubscribe()
  registry.record(entry('second', ['second-route']))
  assert.equal(changes, 2, 'the roster stops observing once it unsubscribes')
})

test('a synchronous observer failure cannot veto a committed registration or starve later observers', async () => {
  const registry = await service()
  let laterChanges = 0
  registry.onChange(() => { throw new Error('observer failed') })
  registry.onChange(() => { laterChanges++ })

  let forget!: () => void
  assert.doesNotThrow(() => {
    forget = registry.record(entry('fixture', ['fixture-route']))
  })
  assert.equal(typeof forget, 'function', 'record must still return the withdrawal handle')
  assert.equal(registry.byId('fixture')?.id, 'fixture')
  assert.equal(registry.byRoute('fixture-route')?.id, 'fixture')
  assert.equal(laterChanges, 1, 'a failed observer must not starve later observers')

  assert.doesNotThrow(() => forget())
  assert.equal(registry.byId('fixture'), undefined)
  assert.equal(registry.byRoute('fixture-route'), undefined)
  assert.equal(laterChanges, 2, 'withdrawal notification is also non-vetoing')
})

test('an async observer rejection is contained after the registry commit', async () => {
  const registry = await service()
  let laterChanges = 0
  registry.onChange(async () => { throw new Error('async observer failed') })
  registry.onChange(() => { laterChanges++ })

  const forget = registry.record(entry('fixture', ['fixture-route']))
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(registry.byId('fixture')?.id, 'fixture')
  assert.equal(laterChanges, 1)
  forget()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(registry.byId('fixture'), undefined)
  assert.equal(laterChanges, 2)
})

test('an empty id is refused', async () => {
  const registry = await service()
  assert.throws(() => registry.record(entry('', [])), /must be a non-empty string/)
})

test('provider ids must already be canonical and are never silently trimmed', async () => {
  const registry = await service()
  assert.throws(() => registry.record(entry(' fixture ', [])), /leading or trailing whitespace/)
  assert.throws(() => registry.record(entry('fixture id', [])), /must not contain whitespace/)
  assert.equal(registry.byId(' fixture '), undefined)
  assert.deepEqual(registry.all(), [])
})

test('provider routes must already be canonical and are never silently trimmed', async () => {
  const registry = await service()
  assert.throws(() => registry.record(entry('fixture', [' route '])), /leading or trailing whitespace/)
  assert.throws(() => registry.record(entry('fixture', ['route with space'])), /must not contain whitespace/)
  assert.equal(registry.byRoute(' route '), undefined)
  assert.deepEqual(registry.all(), [])
})

test('provider identity bounds are enforced at the registry boundary', async () => {
  const registry = await service()
  assert.throws(
    () => registry.record(entry('x'.repeat(MAX_PROVIDER_ID_LENGTH + 1), [])),
    new RegExp(`no longer than ${MAX_PROVIDER_ID_LENGTH}`),
  )
  assert.throws(
    () => registry.record(entry('fixture', ['r'.repeat(MAX_PROVIDER_ROUTE_LENGTH + 1)])),
    new RegExp(`no longer than ${MAX_PROVIDER_ROUTE_LENGTH}`),
  )
})

test('a throwing invalidation listener does not stop the others or reach the caller', async () => {
  // `#announce()` has always contained observer failures, with the reasoning
  // written down: a committed change is not a vote. `invalidate()` did not, and
  // the asymmetry was a real defect -- its caller is a provider refreshing its
  // own usage cache, which would inherit an unrelated plugin's exception.
  const registry = await service()
  const seen: string[] = []
  registry.onInvalidate(() => { seen.push('first') })
  registry.onInvalidate(() => { throw new Error('listener exploded') })
  registry.onInvalidate(() => { seen.push('third') })

  assert.doesNotThrow(() => registry.invalidate('fixture'))
  assert.deepEqual(seen, ['first', 'third'], 'a listener after the throwing one must still run')
})

test('a rejecting async invalidation listener does not become an unhandled rejection', async () => {
  const registry = await service()
  const seen: string[] = []
  registry.onInvalidate((() => Promise.reject(new Error('async listener exploded'))) as () => void)
  registry.onInvalidate(() => { seen.push('after') })

  const unhandled: unknown[] = []
  const capture = (reason: unknown): void => { unhandled.push(reason) }
  process.on('unhandledRejection', capture)
  try {
    registry.invalidate('fixture')
    // Two macrotask turns: enough for a rejection to surface if it were loose.
    await new Promise(resolve => setTimeout(resolve, 20))
  } finally {
    process.off('unhandledRejection', capture)
  }
  assert.deepEqual(seen, ['after'])
  assert.deepEqual(unhandled, [])
})
