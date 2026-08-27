import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as codex from '../src/index.ts'

function fakeContext() {
  const providers = new Map<string, any>()
  const registeredAdapters: Array<{ providers: string[]; adapter: any }> = []
  const recorded: Array<{ id: string; routes: readonly string[] }> = []
  const events = new Map<string, Function[]>()
  const effects: Array<() => void> = []

  return {
    providers,
    registeredAdapters,
    recorded,
    ctx: {
      nishiProviders: {
        record(entry: { id: string; routes: readonly string[] }) {
          recorded.push(entry)
          return () => {}
        },
      },
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

test('1. exact snapshot SHA is documented in THIRD_PARTY_NOTICES.md', async () => {
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
  assert.match(notices, /79fe7503390d641680bad8efade52782a3c31ced/)
  assert.match(notices, /wingoo\/codex-plugin-dsh/)
})

test('2. package.json contains no exotic git subdependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dependencies?.['codex-plugin-dsh'], undefined)
  const allDeps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }
  for (const [name, spec] of Object.entries(allDeps)) {
    assert.equal(String(spec).includes('github:'), false, `${name} must not be a git dependency: ${spec}`)
    assert.equal(String(spec).includes('.git'), false, `${name} must not be a git dependency: ${spec}`)
  }
})

test('3. vendored snapshot creates the adapter but never registers it', async () => {
  const vendored = await import('../src/codex-plugin-dsh/index.ts')
  assert.equal(typeof vendored.createAdapter, 'function')
  assert.equal(typeof vendored.CodexAppServerAdapter, 'function')
  assert.equal(vendored.CODEX_APP_SERVER_PROVIDER, 'codex-app-server')

  // The snapshot is locally modified: upstream's `apply` both created and
  // registered the adapter. Registration now happens once, in the kit's
  // registerProvider, so restoring an `apply` entry here would claim the
  // codex-app-server route twice.
  assert.equal((vendored as Record<string, unknown>).apply, undefined)
  const source = await readFile(new URL('../src/codex-plugin-dsh/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ctx\.llm\.registerAdapter/)
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
