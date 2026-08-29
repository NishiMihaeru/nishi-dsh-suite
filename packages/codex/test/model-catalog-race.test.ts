import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'

function adapter() {
  return new CodexAppServerAdapter({} as any, {
    executable: 'codex',
    env: {},
    modelCacheMs: 30_000,
    catalogTimeoutMs: 10_000,
    turnTimeoutMs: 600_000,
    disposeGraceMs: 3_000,
    stderrMaxBytes: 16_384,
    modelPageSize: 100,
  }) as any
}

test('one caller abort cannot poison a shared model-catalog load', async () => {
  const subject = adapter()
  const gate = Promise.withResolvers<readonly any[]>()
  let loads = 0
  let loaderSignal: AbortSignal | undefined

  subject.loadModels = async (signal: AbortSignal) => {
    loads += 1
    loaderSignal = signal
    return gate.promise
  }

  const caller = new AbortController()
  const first = subject.models(caller.signal)
  const second = subject.models()

  caller.abort(new Error('caller cancelled'))
  await assert.rejects(first, /caller cancelled/)
  assert.equal(loaderSignal?.aborted, false, 'caller cancellation must not abort the shared provider-owned load')

  gate.resolve([{
    id: 'gpt-test',
    name: 'GPT Test',
    supportedReasoningEfforts: [],
    inputModalities: ['text'],
  }])
  const models = await second
  assert.equal(loads, 1)
  assert.equal(models[0]?.id, 'gpt-test')

  const cached = await subject.models()
  assert.equal(loads, 1, 'successful shared load should populate the normal model cache')
  assert.equal(cached[0]?.id, 'gpt-test')
})
