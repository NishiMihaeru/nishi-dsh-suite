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
      effect() {},
      on() {},
      logger: { warn() {} },
    } as any,
  }
}

test('Codex package registers the codex-app-server primary and no subagent provider', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })
  assert.deepEqual([...fixture.adapters.keys()], ['codex-app-server'])
  assert.deepEqual([...fixture.providers.keys()], [], 'delegation was removed in 0.1.0-rc.3')
})

test('Codex package keeps the accepted plugin surface', () => {
  assert.equal(codex.name, 'codex')
  assert.deepEqual(codex.inject, [
    'subprocess',
    'llm',
    'sessions',
    'attachments',
  ])
  assert.equal(typeof codex.apply, 'function')
  assert.equal(typeof codex.Config?.toJSON, 'function')
})
