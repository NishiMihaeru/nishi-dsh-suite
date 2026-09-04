import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCatalog, parseDefaultModelId } from '../src/model-catalog.ts'

/**
 * A trimmed but verbatim `initialize` result from `grok 1.0.13`, recorded by
 * the turn-free handshake probe in `docs/verification/grok-cli-contract.md`
 * (finding 9). The shape is undocumented, which is exactly why it is pinned:
 * this is the only surface publishing the real context window and the
 * reasoning-effort list, and a vendor rename must fail here rather than
 * silently leave the route with no capacity and no efforts.
 */
const RECORDED_INITIALIZE = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  _meta: {
    agentVersion: '1.0.13',
    modelState: {
      currentModelId: 'grok-4.6',
      availableModels: [
        {
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
          description: "SpaceXAI's latest frontier model",
          _meta: {
            totalContextTokens: 500000,
            supportsReasoningEffort: true,
            reasoningEffort: 'high',
            reasoningEfforts: [
              { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort', description: 'Highest effort and reasoning level', default: false },
              { id: 'high', value: 'high', label: 'High Effort', description: 'Higher implementation quality with extensive reasoning', default: true },
              { id: 'medium', value: 'medium', label: 'Medium Effort', description: 'Balanced effort', default: false },
              { id: 'low', value: 'low', label: 'Low Effort', description: 'Quick, fast implementations', default: false },
            ],
          },
        },
        {
          modelId: 'grok-4.5',
          name: 'Grok 4.5',
          _meta: {
            totalContextTokens: 500000,
            supportsReasoningEffort: true,
            reasoningEfforts: [
              { id: 'high', value: 'high', label: 'High Effort', default: true },
              { id: 'low', value: 'low', label: 'Low Effort', default: false },
            ],
          },
        },
      ],
    },
  },
}

test('the recorded handshake yields both models with their published windows', () => {
  const models = parseCatalog(RECORDED_INITIALIZE)
  assert.deepEqual(models.map(model => model.id), ['grok-4.6', 'grok-4.5'])
  assert.equal(models[0].contextWindowTokens, 500000)
  assert.equal(models[1].contextWindowTokens, 500000)
  assert.equal(models[0].name, 'Grok 4.6')
})

test('efforts keep vendor order and name their default', () => {
  const [flagship] = parseCatalog(RECORDED_INITIALIZE)
  assert.deepEqual(flagship.efforts.map(effort => effort.id), ['xhigh', 'high', 'medium', 'low'])
  assert.deepEqual(
    flagship.efforts.filter(effort => effort.isDefault).map(effort => effort.id),
    ['high'],
  )
  assert.equal(flagship.efforts[0].name, 'Extra High Effort')
})

test('the current model is reported when the handshake names one', () => {
  assert.equal(parseDefaultModelId(RECORDED_INITIALIZE), 'grok-4.6')
  assert.equal(parseDefaultModelId({}), undefined)
})

test('a model with no window and no efforts is reported as having neither', () => {
  const models = parseCatalog({
    _meta: { modelState: { availableModels: [{ modelId: 'bare' }] } },
  })
  assert.deepEqual(models, [{ id: 'bare', name: 'bare', efforts: [] }])
})

test('a renamed or absent catalog yields an empty list rather than a crash', () => {
  assert.deepEqual(parseCatalog(undefined), [])
  assert.deepEqual(parseCatalog({ _meta: {} }), [])
  assert.deepEqual(parseCatalog({ _meta: { modelState: { availableModels: 'nope' } } }), [])
})

test('entries with no model id are skipped rather than named after nothing', () => {
  const models = parseCatalog({
    _meta: { modelState: { availableModels: [{ name: 'no id' }, { modelId: 'ok' }] } },
  })
  assert.deepEqual(models.map(model => model.id), ['ok'])
})

test('a nonsense window is dropped rather than advertised', () => {
  const models = parseCatalog({
    _meta: {
      modelState: {
        availableModels: [{ modelId: 'x', _meta: { totalContextTokens: -1 } }],
      },
    },
  })
  assert.equal(models[0].contextWindowTokens, undefined)
})
