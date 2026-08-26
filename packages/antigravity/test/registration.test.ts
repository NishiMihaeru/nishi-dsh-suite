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
      projectMemory: { async createSubagentContext() { return { projectRoot: '/repo', renderedBootstrap: null, async readTopic(topic: string) { return { topic, exists: false, content: null } } } } },
      effect() {},
      logger: { warn() {} },
    } as any,
  }
}

test('Antigravity package registers only the antigravity subagent provider', () => {
  const fixture = fakeContext()
  antigravity.apply(fixture.ctx, {})
  assert.deepEqual([...fixture.providers.keys()], ['antigravity'])
  assert.equal(fixture.providers.has('codex'), false)
})

test('Antigravity package exposes the independent plugin surface', () => {
  assert.equal(antigravity.name, 'subagent-antigravity')
  assert.deepEqual(antigravity.inject, ['subagents', 'subprocess', 'llm', 'projectMemory'])
  assert.equal(typeof antigravity.apply, 'function')
})
