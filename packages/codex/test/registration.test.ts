import assert from 'node:assert/strict'
import test from 'node:test'
import * as codex from '../src/index.ts'

function fakeContext() {
  const providers = new Map<string, any>()
  const adapters = new Map<string, any>()
  return {
    providers,
    adapters,
    ctx: {
      subagents: { registerProvider(value: any) { providers.set(value.name, value) } },
      subprocess: { spawn() { throw new Error('spawn must not be reached') } },
      llm: {
        registerAdapter(providerNames: string[], adapter: any) {
          for (const name of providerNames) {
            adapters.set(name, adapter)
          }
        },
      },
      projectMemory: { async createSubagentContext() { return { projectRoot: '/repo', renderedBootstrap: null, async readTopic(topic: string) { return { topic, exists: false, content: null } } } } },
      effect() {},
      on() {},
      logger: { warn() {} },
    } as any,
  }
}

test('Codex package registers only the codex subagent provider and codex-app-server primary', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })
  assert.deepEqual([...fixture.providers.keys()], ['codex'])
  assert.equal(fixture.providers.has('antigravity'), false)
  assert.deepEqual([...fixture.adapters.keys()], ['codex-app-server'])
})

test('Codex package keeps the accepted plugin surface', () => {
  assert.equal(codex.name, 'subagent-codex')
  assert.deepEqual(codex.inject, ['subagents', 'subprocess', 'llm', 'projectMemory'])
  assert.equal(typeof codex.apply, 'function')
  assert.equal(typeof codex.Config?.toJSON, 'function')
})
