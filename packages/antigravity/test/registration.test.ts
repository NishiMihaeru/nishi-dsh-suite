import assert from 'node:assert/strict'
import test from 'node:test'
import * as antigravity from '../src/index.ts'

function fakeContext() {
  const providers = new Map<string, any>()
  const adapters = new Map<string, unknown>()
  return {
    providers,
    adapters,
    ctx: {
      subagents: { registerProvider(value: any) { providers.set(value.name, value) } },
      subprocess: {
        spawn() { throw new Error('spawn must not be reached') },
        async resolveExecutable(value: string) { return value },
      },
      llm: { registerAdapter(names: string[], adapter: unknown) { for (const name of names) adapters.set(name, adapter) } },
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
})

test('Antigravity package exposes the independent plugin surface', () => {
  assert.equal(antigravity.name, 'antigravity')
  assert.deepEqual(antigravity.inject, ['subprocess', 'llm'])
  assert.equal(typeof antigravity.apply, 'function')
})
