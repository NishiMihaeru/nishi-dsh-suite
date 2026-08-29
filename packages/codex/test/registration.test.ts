import assert from 'node:assert/strict'
import test from 'node:test'
import * as codex from '../src/index.ts'

function fakeContext() {
  const recorded: any[] = []
  const providers = new Map<string, any>()
  const adapters = new Map<string, any>()
  return {
    providers,
    adapters,
    recorded,
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
      nishiProviders: { record(entry: any) { recorded.push(entry); return () => {} } },
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
  assert.deepEqual(
    fixture.recorded.map((entry: any) => ({ id: entry.id, routes: entry.routes })),
    [{ id: 'codex', routes: ['codex-app-server'] }],
    'the core learns the provider through the registry, not by importing it',
  )
})

test('Codex registration gives routed search the same configured executable environment', async () => {
  const fixture = fakeContext()
  const env = {
    DSH_CODEX_EXECUTABLE: '/vendor/codex',
    CODEX_HOME: '/vendor/codex-home',
    PATH: '/vendor/bin',
  }

  await codex.apply(fixture.ctx, { env, disposeGraceMs: 3000 })

  assert.equal(fixture.recorded.length, 1)
  const search = fixture.recorded[0]?.webSearch as any
  assert.ok(search, 'Codex provider should publish its routed search backend')
  assert.equal(search.config.executable, '/vendor/codex')
  assert.deepEqual(search.config.env, env)
})

test('Codex registration declares a Model Accounts row for the ChatGPT/Codex credential', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })

  assert.equal(fixture.recorded.length, 1)
  assert.deepEqual(fixture.recorded[0].descriptor.account, {
    credentialScope: 'llm-pi-ai',
    credentialId: 'openai-codex',
    label: 'ChatGPT / Codex',
  })
})

test('Codex package keeps the accepted plugin surface', () => {
  assert.equal(codex.name, 'codex')
  assert.deepEqual(codex.inject, [
    'nishiProviders',
    'subprocess',
    'llm',
    'sessions',
    'attachments',
  ])
  assert.equal(typeof codex.apply, 'function')
  assert.equal(typeof codex.Config?.toJSON, 'function')
})
