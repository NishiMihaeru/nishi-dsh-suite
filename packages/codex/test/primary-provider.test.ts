import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as codex from '../src/index.ts'

const EXPECTED_PIN_SHA = '79fe7503390d641680bad8efade52782a3c31ced'
const EXPECTED_DEPENDENCY_SPEC = `github:wingoo/codex-plugin-dsh#${EXPECTED_PIN_SHA}`

function fakeContext() {
  const providers = new Map<string, any>()
  const registeredAdapters: Array<{ providers: string[]; adapter: any }> = []
  const events = new Map<string, Function[]>()
  const effects: Array<() => void> = []

  return {
    providers,
    registeredAdapters,
    ctx: {
      subagents: {
        registerProvider(value: any) {
          providers.set(value.name, value)
        },
      },
      subprocess: {
        spawn() {
          throw new Error('spawn must not be reached during registration')
        },
        async resolveExecutable(name: string) {
          return name
        },
      },
      llm: {
        registerAdapter(providerNames: string[], adapter: any) {
          registeredAdapters.push({ providers: providerNames, adapter })
        },
      },
      projectMemory: {
        async createSubagentContext() {
          return {
            projectRoot: '/repo',
            renderedBootstrap: null,
            async readTopic(topic: string) {
              return { topic, exists: false, content: null }
            },
          }
        },
      },
      on(event: string, listener: Function) {
        const list = events.get(event) ?? []
        list.push(listener)
        events.set(event, list)
      },
      effect(fn: () => () => void) {
        const cleanup = fn()
        if (typeof cleanup === 'function') effects.push(cleanup)
      },
      logger: {
        warn() {},
      },
    } as any,
  }
}

test('1. exact pin exists in packages/codex/package.json', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const actualSpec = manifest.dependencies?.['codex-plugin-dsh']
  assert.equal(
    actualSpec,
    EXPECTED_DEPENDENCY_SPEC,
    `nishi-dsh-codex must have dependency "codex-plugin-dsh": "${EXPECTED_DEPENDENCY_SPEC}"`,
  )
})

test('2. pin is an exact 40-character hex commit SHA and NOT main/tag/range', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const actualSpec = String(manifest.dependencies?.['codex-plugin-dsh'] ?? '')
  assert.match(actualSpec, /^github:wingoo\/codex-plugin-dsh#[0-9a-f]{40}$/)
  assert.equal(actualSpec.includes('main'), false, 'pin must not float on main branch')
  assert.equal(actualSpec.includes('master'), false, 'pin must not float on master branch')
  assert.equal(actualSpec.includes('^'), false, 'pin must not use semver range')
  assert.equal(actualSpec.includes('~'), false, 'pin must not use semver range')
  const sha = actualSpec.split('#')[1]
  assert.equal(sha, EXPECTED_PIN_SHA)
})

test('3. package ownership does not depend on hoisting', async () => {
  // Verify that codex-plugin-dsh is resolvable directly from nishi-dsh-codex
  const codexPkgUrl = new URL('../package.json', import.meta.url)
  const manifest = JSON.parse(await readFile(codexPkgUrl, 'utf8'))
  assert.ok(
    manifest.dependencies && 'codex-plugin-dsh' in manifest.dependencies,
    'nishi-dsh-codex must directly own codex-plugin-dsh in its own package.json dependencies',
  )
})

test('4. fresh Suite composition provides codex-app-server', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })
  const allRegisteredProviders = fixture.registeredAdapters.flatMap((a) => a.providers)
  assert.ok(
    allRegisteredProviders.includes('codex-app-server'),
    `codex-app-server provider must be registered in ctx.llm; got: ${JSON.stringify(allRegisteredProviders)}`,
  )
})

test('5. registration is exactly one', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })
  const codexAppServerRegistrations = fixture.registeredAdapters.filter((a) =>
    a.providers.includes('codex-app-server'),
  )
  assert.equal(
    codexAppServerRegistrations.length,
    1,
    `expected exactly 1 registration for codex-app-server, got ${codexAppServerRegistrations.length}`,
  )
})

test('6. openai-codex is not a Nishi fallback', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })
  const allRegisteredProviders = fixture.registeredAdapters.flatMap((a) => a.providers)
  assert.equal(
    allRegisteredProviders.includes('openai-codex'),
    false,
    'openai-codex must never be registered by Nishi codex integration',
  )
})

test('7. Nishi bridge patches exact CodexAppServerAdapter', async () => {
  const fixture = fakeContext()
  await codex.apply(fixture.ctx, { env: {}, disposeGraceMs: 3000 })
  const adapterEntry = fixture.registeredAdapters.find((a) =>
    a.providers.includes('codex-app-server'),
  )
  assert.ok(adapterEntry, 'codex-app-server adapter must be registered')
  const adapter = adapterEntry.adapter
  const proto = Object.getPrototypeOf(adapter)
  assert.equal(
    typeof proto.stream,
    'function',
    'adapter prototype must have stream method',
  )
  // Verify that the patched stream or openConnection exists on prototype
  const bridgeSymbol = Symbol.for('dsh-plugin.codex-primary.history-bridge.v2')
  assert.ok(
    proto[bridgeSymbol],
    'adapter prototype must be patched with Nishi primary history bridge state',
  )
})
