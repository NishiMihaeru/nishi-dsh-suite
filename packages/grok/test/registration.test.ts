import assert from 'node:assert/strict'
import test from 'node:test'
import * as grok from '../src/index.ts'

function fakeContext() {
  const recorded: any[] = []
  const adapters = new Map<string, unknown>()
  return {
    adapters,
    recorded,
    ctx: {
      subprocess: {
        spawn() { throw new Error('spawn must not be reached') },
        async resolveExecutable(value: string) { return value },
      },
      llm: {
        registerAdapter(names: string[], adapter: unknown) {
          for (const name of names) adapters.set(name, adapter)
        },
      },
      nishiProviders: { record(entry: any) { recorded.push(entry); return () => {} } },
      effect() {},
      logger: { warn() {} },
    } as any,
  }
}

test('Grok package registers the grok-cli primary route', async () => {
  const fixture = fakeContext()
  await grok.apply(fixture.ctx, {})
  assert.deepEqual([...fixture.adapters.keys()], ['grok-cli'])
  assert.deepEqual(
    fixture.recorded.map((entry: any) => ({ id: entry.id, routes: entry.routes })),
    [{ id: 'grok', routes: ['grok-cli'] }],
    'the core learns the provider through the registry, not by importing it',
  )
})

test('Grok declares usage over ACP billing, and a native search backend', async () => {
  const fixture = fakeContext()
  await grok.apply(fixture.ctx, {})
  const entry = fixture.recorded[0]
  assert.equal(typeof entry.usage?.collector?.collect, 'function')
  assert.equal(typeof entry.webSearch?.search, 'function')
})

test('Grok presentation carries no vendor logo path', async () => {
  const fixture = fakeContext()
  await grok.apply(fixture.ctx, {})
  const presentation = fixture.recorded[0].presentation
  assert.equal(presentation.id, 'grok')
  assert.equal(
    presentation.iconPath,
    undefined,
    'xAI Brand Guidelines allow logos only exactly as provided; this row renders the neutral mark',
  )
})

test('Grok package exposes the independent plugin surface', () => {
  assert.equal(grok.name, 'grok')
  assert.deepEqual(grok.inject, ['nishiProviders', 'subprocess', 'llm'])
  assert.equal(typeof grok.apply, 'function')
})

test('Grok rejects an empty executable and a non-positive context window or search timeout', async () => {
  const fixture = fakeContext()
  await assert.rejects(
    () => grok.apply(fixture.ctx, { executable: '  ' }),
    /executable must be non-empty/,
  )
  await assert.rejects(
    () => grok.apply(fixture.ctx, { contextWindowTokens: 0 }),
    /contextWindowTokens must be a positive integer/,
  )
  await assert.rejects(
    () => grok.apply(fixture.ctx, { searchTimeoutMs: 0 }),
    /searchTimeoutMs must be a positive integer/,
  )
})
