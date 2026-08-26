import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as codex from '../src/index.ts'

interface RecordedProvider {
  readonly name: string
  readonly capabilities: unknown
  readonly inheritsParentContext: boolean
  start(request: any): Promise<unknown>
}

function fakeContext() {
  const providers = new Map<string, RecordedProvider>()
  const registeredAdapters: Record<string, unknown> = {}

  const ctx = {
    subagents: {
      registerProvider(value: RecordedProvider) {
        providers.set(value.name, value)
      },
    },
    subprocess: {
      spawn() {
        throw new Error('spawn must not be reached by registration tests')
      },
    },
    llm: {
      registerAdapter(names: string[], adapter: unknown) {
        for (const n of names) registeredAdapters[n] = adapter
      },
    },
    effect(_fn: () => unknown) {},
    logger: {
      warn() {},
    },
  }

  return {
    ctx: ctx as any,
    providers,
    provider(name: string): RecordedProvider {
      const provider = providers.get(name)
      assert.ok(provider, `provider ${name} should have been registered`)
      return provider
    },
  }
}

const defaults = {
  env: {},
  disposeGraceMs: 3_000,
} as const

test('plugin exports the upstream-compatible Cordis surface and registration name codex', () => {
  assert.equal(codex.name, 'subagent-codex')
  assert.deepEqual(codex.inject, ['subagents', 'subprocess', 'llm', 'projectMemory'])
  assert.equal(typeof codex.apply, 'function')
  assert.equal(typeof codex.Config?.toJSON, 'function')
})

test('registration preserves exact Codex provider name and fixed capabilities', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, defaults)

  const provider = fixture.provider('codex')
  assert.equal(provider.name, 'codex')
  assert.equal(provider.inheritsParentContext, false)
  assert.deepEqual(provider.capabilities, {
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  })
  assert.ok(fixture.providers.has('antigravity'))
})

test('registration preserves upstream disposal-grace validation', async () => {
  for (const disposeGraceMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      async () => await codex.apply(fakeContext().ctx, { ...defaults, disposeGraceMs }),
      /disposeGraceMs.*positive finite/i,
    )
  }
  await assert.rejects(
    async () => await codex.apply(fakeContext().ctx, {
      ...defaults,
      disposeGraceMs: MAX_TIMER_DELAY_MS + 1,
    }),
    new RegExp(`disposeGraceMs.*${MAX_TIMER_DELAY_MS}`),
  )
})

test('Codex provider rejects a missing parent cwd before process spawn', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, defaults)

  await assert.rejects(
    fixture.provider('codex').start({
      prompt: [{ type: 'text', text: 'task' }],
      parent: { session: { header: {} } },
      signal: new AbortController().signal,
    }),
    /no working directory for the child/i,
  )
})
