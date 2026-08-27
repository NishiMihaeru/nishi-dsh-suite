import assert from 'node:assert/strict'
import test from 'node:test'
import { ClaudeUsageCollector, ClaudeUsageSourceError } from '../src/usage.ts'

test('recognized Claude source failures become safe non-active snapshots', async () => {
  for (const code of ['LOGIN_REQUIRED', 'UNAVAILABLE'] as const) {
    const snapshot = await new ClaudeUsageCollector({
      async read() { throw new ClaudeUsageSourceError('vendor stderr must not escape', code) },
    }).collect(1234)

    assert.equal(snapshot.status, code)
    assert.equal(snapshot.providerId, 'claude')
    assert.deepEqual(snapshot.windows, [])
    assert.doesNotMatch(JSON.stringify(snapshot), /vendor stderr/)
  }
})

test('an unknown Claude failure collapses to ERROR without vendor stderr', async () => {
  const snapshot = await new ClaudeUsageCollector({
    async read() { throw new Error('claude secret stderr') },
  }).collect(1)

  assert.equal(snapshot.status, 'ERROR')
  assert.deepEqual(snapshot.windows, [])
  assert.doesNotMatch(JSON.stringify(snapshot), /secret stderr/)
})
