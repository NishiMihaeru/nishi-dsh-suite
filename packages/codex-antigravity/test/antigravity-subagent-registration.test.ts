import assert from 'node:assert/strict'
import test from 'node:test'
import * as plugin from '../src/index.ts'

interface RecordedProvider {
  readonly name: string
  readonly capabilities: unknown
  readonly inheritsParentContext: boolean
  start(request: any): Promise<unknown>
}

function fakeContext() {
  const providers = new Map<string, RecordedProvider>()
  const adapters = new Map<string, unknown>()
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
        for (const name of names) adapters.set(name, adapter)
      },
    },
    projectMemory: {
      async createSubagentContext() {
        return {
          projectRoot: 'C:/repo',
          renderedBootstrap: null,
          async readTopic(topic: string) {
            return { topic, exists: false, content: null }
          },
        }
      },
    },
    effect(_fn: () => unknown) {},
    logger: { warn() {} },
  }
  return { ctx: ctx as any, providers, adapters }
}

test('plugin registers managed Antigravity subagent beside Codex', async () => {
  const fixture = fakeContext()
  await plugin.apply(fixture.ctx, { env: {}, disposeGraceMs: 3_000 })

  assert.deepEqual([...fixture.providers.keys()].sort(), ['antigravity', 'codex'])
  const provider = fixture.providers.get('antigravity')
  assert.ok(provider)
  assert.equal(provider.inheritsParentContext, false)
  assert.deepEqual(provider.capabilities, {
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  })
})

test('managed Antigravity subagent rejects missing parent cwd before invoking agy', async () => {
  const fixture = fakeContext()
  await plugin.apply(fixture.ctx, { env: {}, disposeGraceMs: 3_000 })
  const provider = fixture.providers.get('antigravity')
  assert.ok(provider)

  await assert.rejects(
    provider.start({
      prompt: [{ type: 'text', text: 'task' }],
      parent: { session: { header: {} } },
      signal: new AbortController().signal,
    }),
    /subagent-antigravity.*no working directory/i,
  )
})
