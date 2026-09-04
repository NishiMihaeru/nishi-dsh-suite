import assert from 'node:assert/strict'
import test from 'node:test'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import {
  filterVisibleModels,
  hiddenModelKey,
  normalizeHiddenModels,
} from '../src/model-visibility.ts'
import {
  HIDDEN_MODELS_STORAGE_KEY,
  loadHiddenModels,
  saveHiddenModels,
  setModelVisible,
} from '../src/client/model-visibility.ts'
import { withModelVisibility } from '../src/runtime/registration.ts'

test('hidden model entries normalize, deduplicate, and filter complete routes', () => {
  const hidden = normalizeHiddenModels([
    { provider: ' alpha ', model: ' one ' },
    { provider: 'alpha', model: 'one' },
    { provider: '', model: 'bad' },
    null,
  ])
  assert.deepEqual(hidden, [{ provider: 'alpha', model: 'one' }])
  const keys = new Set(hidden.map((entry) => hiddenModelKey(entry.provider, entry.model)))
  const models = [
    { provider: 'alpha', id: 'one', name: 'One' },
    { provider: 'alpha', id: 'two', name: 'Two' },
  ]
  assert.deepEqual(filterVisibleModels('alpha', models, keys), [models[1]])
  assert.deepEqual(filterVisibleModels('beta', models, keys), models)
})

test('browser storage persists visibility and show/hide mutations are reversible', () => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
  const hidden = setModelVisible([], 'alpha', 'one', false)
  saveHiddenModels(hidden, storage)
  assert.equal(data.has(HIDDEN_MODELS_STORAGE_KEY), true)
  assert.deepEqual(loadHiddenModels(storage), hidden)
  const visible = setModelVisible(hidden, 'alpha', 'one', true)
  saveHiddenModels(visible, storage)
  assert.deepEqual(visible, [])
  assert.equal(data.has(HIDDEN_MODELS_STORAGE_KEY), false)
})

test('adapter wrapper filters listModels but preserves model resolution behavior', async () => {
  const adapter = {
    async listModels(provider: string) {
      return [
        { provider, id: 'keep', name: 'Keep' },
        { provider, id: 'hide', name: 'Hide' },
      ]
    },
    async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model }
    },
  } as unknown as LlmAdapter
  const wrapped = withModelVisibility(adapter, (_provider, model) => model !== 'hide')
  assert.deepEqual((await wrapped.listModels('alpha')).map((model) => model.id), ['keep'])
  const resolved = await wrapped.resolveModel('alpha', 'hide')
  assert.equal(resolved.id, 'hide', 'hidden current/explicit models must remain resolvable')
})
