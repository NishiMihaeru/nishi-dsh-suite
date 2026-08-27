import assert from 'node:assert/strict'
import test from 'node:test'
import * as antigravity from '../src/index.ts'

function fakeContext() {
  const recorded: any[] = []
  const providers = new Map<string, any>()
  const adapters = new Map<string, unknown>()
  return {
    providers,
    adapters,
    recorded,
    ctx: {
      subagents: { registerProvider(value: any) { providers.set(value.name, value) } },
      subprocess: {
        spawn() { throw new Error('spawn must not be reached') },
        async resolveExecutable(value: string) { return value },
      },
      llm: { registerAdapter(names: string[], adapter: unknown) { for (const name of names) adapters.set(name, adapter) } },
      nishiProviders: { record(entry: any) { recorded.push(entry); return () => {} } },
      effect() {},
      logger: { warn() {} },
    } as any,
  }
}

test('Antigravity package registers the antigravity-cli primary and no subagent provider', async () => {
  const fixture = fakeContext()
  await antigravity.apply(fixture.ctx, {})
  assert.deepEqual([...fixture.adapters.keys()], ['antigravity-cli'])
  assert.deepEqual([...fixture.providers.keys()], [], 'delegation was removed in 0.1.0-rc.3')
  assert.deepEqual(
    fixture.recorded.map((entry: any) => ({ id: entry.id, routes: entry.routes })),
    [{ id: 'antigravity', routes: ['antigravity-cli'] }],
    'the core learns the provider through the registry, not by importing it',
  )
})

test('Antigravity package exposes the independent plugin surface', () => {
  assert.equal(antigravity.name, 'antigravity')
  assert.deepEqual(antigravity.inject, ['nishiProviders', 'subprocess', 'llm'])
  assert.equal(typeof antigravity.apply, 'function')
})
