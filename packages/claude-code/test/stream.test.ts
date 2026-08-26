import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeClaudeStream } from '../src/stream.ts'

async function* lines(values: readonly string[]) {
  for (const value of values) yield value
}

test('assistant text wins even when terminal success result text is empty', async () => {
  const result = await consumeClaudeStream(lines([
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
      },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }),
  ]))

  assert.equal(result.text, 'hello world')
  assert.equal(result.stopReason, 'completed')
})

test('terminal success result is a fallback when no assistant text was streamed', async () => {
  const result = await consumeClaudeStream(lines([
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'fallback answer' }),
  ]))

  assert.equal(result.text, 'fallback answer')
  assert.equal(result.stopReason, 'completed')
})

test('terminal result stops stream consumption immediately', async () => {
  async function* terminalThenTrap() {
    yield JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'done' }] },
    })
    yield JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' })
    throw new Error('decoder read past terminal result')
  }

  const result = await consumeClaudeStream(terminalThenTrap())
  assert.equal(result.text, 'done')
  assert.equal(result.stopReason, 'completed')
})

test('malformed JSON is a safe protocol failure', async () => {
  await assert.rejects(
    consumeClaudeStream(lines(['{ definitely-not-json'])),
    (error: any) => error?.facts?.category === 'protocol',
  )
})

test('terminal error subtype maps to a safe failure category', async () => {
  await assert.rejects(
    consumeClaudeStream(lines([
      JSON.stringify({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        result: '',
        errors: ['internal detail must remain on cause only'],
      }),
    ])),
    (error: any) => error?.facts?.category === 'error_max_turns',
  )
})

test('rate-limit and permission events call safe hooks without becoming output', async () => {
  let rateLimitEvents = 0
  let permissionDeniedEvents = 0

  const result = await consumeClaudeStream(
    lines([
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
      JSON.stringify({ type: 'system', subtype: 'permission_denied' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'answer' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }),
    ]),
    {
      onUsageInvalidated() {
        rateLimitEvents += 1
      },
      onPermissionDenied() {
        permissionDeniedEvents += 1
      },
    },
  )

  assert.equal(result.text, 'answer')
  assert.equal(rateLimitEvents, 1)
  assert.equal(permissionDeniedEvents, 1)
})

test('EOF without a terminal result fails closed', async () => {
  await assert.rejects(
    consumeClaudeStream(lines([
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial answer' }] },
      }),
    ])),
    (error: any) => error?.facts?.category === 'missing-result',
  )
})
