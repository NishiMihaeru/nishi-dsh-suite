import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decisionPayload,
  parseHeadlessResult,
  settlement,
  usageFrom,
} from '../src/headless-result.ts'

/**
 * A verbatim envelope from `grok 1.0.13`, recorded by the probe in
 * `docs/verification/grok-cli-contract.md`. It is here so a vendor rename
 * fails a test rather than a session.
 */
const RECORDED = JSON.stringify({
  text: '{"kind":"message","text":"pineapple","turn":"T1","tool_calls":[]}',
  stopReason: 'end_turn',
  sessionId: '01a06ad0-2761-7fe1-bd34-106a379879d9',
  requestId: '8e6a86db-5dc8-4cad-a279-c5c6f9495e82',
  thought: 'The user has attached a DSH envelope.',
  usage: {
    input_tokens: 4660,
    cache_read_input_tokens: 128,
    cache_creation_input_tokens: 0,
    output_tokens: 375,
    reasoning_tokens: 353,
    total_tokens: 5163,
  },
  num_turns: 1,
  total_cost_usd: 0.003946856,
  structuredOutput: { kind: 'message', text: 'pineapple', turn: 'T1', tool_calls: [] },
})

test('the recorded envelope parses into text, stop reason, session and decision', () => {
  const result = parseHeadlessResult(RECORDED)
  assert.equal(result.stopReason, 'end_turn')
  assert.equal(result.sessionId, '01a06ad0-2761-7fe1-bd34-106a379879d9')
  assert.deepEqual(decisionPayload(result), {
    kind: 'message',
    text: 'pineapple',
    turn: 'T1',
    tool_calls: [],
  })
})

test('usage maps onto disjoint DSH buckets with no subtraction', () => {
  const result = parseHeadlessResult(RECORDED)
  assert.deepEqual(result.usage, {
    inputTokens: 4660,
    outputTokens: 375,
    cacheReadTokens: 128,
    cacheWriteTokens: 0,
    reasoningTokens: 353,
    totalTokens: 5163,
  })
})

test('an incomplete ledger drops the total rather than reporting a confident undercount', () => {
  const usage = usageFrom(
    { input_tokens: 10, output_tokens: 2, total_tokens: 0 },
    true,
  )
  assert.equal(usage?.totalTokens, undefined)
  assert.equal(usage?.inputTokens, 10)
})

test('both structured-output spellings are read, because the vendor uses one per format', () => {
  const camel = parseHeadlessResult(JSON.stringify({
    text: '', stopReason: 'end_turn', structuredOutput: { kind: 'message', turn: 'A' },
  }))
  const snake = parseHeadlessResult(JSON.stringify({
    text: '', stopReason: 'end_turn', structured_output: { kind: 'message', turn: 'B' },
  }))
  assert.equal((decisionPayload(camel) as any).turn, 'A')
  assert.equal((decisionPayload(snake) as any).turn, 'B')
})

test('a decision is read out of the reply text when no structured field is present', () => {
  const result = parseHeadlessResult(JSON.stringify({
    text: '{"kind":"message","text":"hi","turn":"T","tool_calls":[]}',
    stopReason: 'end_turn',
  }))
  assert.deepEqual(decisionPayload(result), {
    kind: 'message', text: 'hi', turn: 'T', tool_calls: [],
  })
})

test('prose in the reply text yields no decision rather than a parse crash', () => {
  const result = parseHeadlessResult(JSON.stringify({ text: 'just prose', stopReason: 'end_turn' }))
  assert.equal(decisionPayload(result), undefined)
})

test('empty or non-JSON stdout is a protocol error', () => {
  assert.throws(() => parseHeadlessResult('   '), /produced no output/)
  assert.throws(() => parseHeadlessResult('not json'), /not JSON/)
  assert.throws(() => parseHeadlessResult('[]'), /non-object result envelope/)
})

test('each published stop reason gets its own settlement kind', () => {
  const at = (stopReason: string | undefined, exitCode: number | null = 0) =>
    settlement(parseHeadlessResult(JSON.stringify(
      stopReason === undefined ? { text: '' } : { text: '', stopReason },
    )), exitCode)

  assert.deepEqual(at('end_turn'), { kind: 'success' })
  assert.deepEqual(at('max_tokens'), { kind: 'max-tokens' })
  assert.deepEqual(at('cancelled'), { kind: 'cancelled' })
  assert.deepEqual(at('refusal'), { kind: 'failed', category: 'refusal' })
  assert.deepEqual(at('max_turn_requests'), { kind: 'failed', category: 'turn-cap' })
  assert.deepEqual(at('something_new'), { kind: 'failed', category: 'unrecognized-stop-reason' })
})

test('a missing stop reason never settles as success', () => {
  const clean = settlement(parseHeadlessResult(JSON.stringify({ text: 'x' })), 0)
  assert.deepEqual(clean, { kind: 'failed', category: 'unsettled' })
  const crashed = settlement(parseHeadlessResult(JSON.stringify({ text: 'x' })), 1)
  assert.deepEqual(crashed, { kind: 'failed', category: 'process-failure' })
})

/**
 * `cancelled` is the vendor's word for two different endings.
 *
 * Exhausting `--max-turns` reports `stopReason: "cancelled"` with
 * `Error: max turns reached` on stderr -- measured on `grok 1.0.13` while
 * diagnosing the first real DSH request. Reporting that as a cancellation
 * tells the DSH loop the user stopped the turn, which is a lie about who ended
 * it and hides the one condition this route can act on.
 */
test('an exhausted turn cap is a failure, not a cancellation', () => {
  const result = parseHeadlessResult(JSON.stringify({ text: '', stopReason: 'cancelled' }))
  assert.deepEqual(
    settlement(result, 1, 'Error: max turns reached\n'),
    { kind: 'failed', category: 'turn-cap' },
  )
  assert.deepEqual(settlement(result, 1, ''), { kind: 'cancelled' })
  assert.deepEqual(settlement(result, 1), { kind: 'cancelled' })
})

test('a turn that produced no schema-bound output says so, without quoting the vendor', () => {
  const result = parseHeadlessResult(JSON.stringify({
    text: '',
    stopReason: 'cancelled',
    structuredOutput: null,
    structuredOutputError: 'model did not produce structured output',
  }))
  assert.equal(result.noStructuredOutput, true)
  assert.equal(decisionPayload(result), undefined)
  const clean = parseHeadlessResult(JSON.stringify({ text: '', stopReason: 'end_turn' }))
  assert.equal(clean.noStructuredOutput, false)
})

test('the error envelope settles as a vendor error and keeps its message off the result', () => {
  const result = parseHeadlessResult(JSON.stringify({
    type: 'error',
    message: "Couldn't start session: /home/someone/secret/path",
  }))
  assert.deepEqual(settlement(result, 1), { kind: 'failed', category: 'vendor-error' })
  assert.equal(result.text, '')
})
