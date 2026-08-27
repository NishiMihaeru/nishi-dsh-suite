import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { NishiProvidersService } from '../src/registry/service.ts'

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
  registry.record(entry('codex', ['codex-app-server', 'codex-legacy']))

  assert.equal(registry.byId('codex')?.id, 'codex')
  assert.equal(registry.byRoute('codex-app-server')?.id, 'codex')
  assert.equal(registry.byRoute('codex-legacy')?.id, 'codex')
  assert.equal(registry.byRoute('unknown'), undefined)
  assert.deepEqual(registry.all().map((provider) => provider.id), ['codex'])
})

test('a duplicate id is refused', async () => {
  const registry = await service()
  registry.record(entry('codex', ['codex-app-server']))
  assert.throws(() => registry.record(entry('codex', ['other-route'])), /already registered/)
})

test('a duplicate route is refused, naming the provider that already owns it', async () => {
  const registry = await service()
  registry.record(entry('codex', ['shared-route']))
  assert.throws(
    () => registry.record(entry('antigravity', ['shared-route'])),
    /route "shared-route" is already served by provider "codex"/,
  )
  assert.equal(registry.byId('antigravity'), undefined, 'a refused registration leaves nothing behind')
})

test('a usage-only provider declaring no route is registered and serves none', async () => {
  const registry = await service()
  registry.record(entry('claude', []))
  assert.equal(registry.byId('claude')?.id, 'claude')
  assert.deepEqual(registry.all().map((provider) => provider.id), ['claude'])
})

test('withdrawing a registration removes its id and its routes', async () => {
  const registry = await service()
  const forget = registry.record(entry('codex', ['codex-app-server']))
  forget()
  assert.equal(registry.byId('codex'), undefined)
  assert.equal(registry.byRoute('codex-app-server'), undefined)
  assert.deepEqual(registry.all(), [])
  forget()
  assert.deepEqual(registry.all(), [], 'withdrawing twice is a no-op')
})

test('withdrawing a replaced entry does not remove the replacement', async () => {
  const registry = await service()
  const forget = registry.record(entry('codex', ['codex-app-server']))
  forget()
  registry.record(entry('codex', ['codex-app-server']))
  forget()
  assert.equal(registry.byId('codex')?.id, 'codex', 'the stale disposer must not evict the live entry')
})

test('a listener sees every registration change until it unsubscribes', async () => {
  const registry = await service()
  let changes = 0
  const unsubscribe = registry.onChange(() => { changes++ })

  const forget = registry.record(entry('codex', ['codex-app-server']))
  assert.equal(changes, 1)
  forget()
  assert.equal(changes, 2)

  unsubscribe()
  registry.record(entry('antigravity', ['antigravity-cli']))
  assert.equal(changes, 2, 'the roster stops observing once it unsubscribes')
})

test('an empty id is refused', async () => {
  const registry = await service()
  assert.throws(() => registry.record(entry('   ', [])), /must be non-empty/)
})
