import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AntigravityUsageCollector,
  AntigravityUsageSourceError,
  ClaudeUsageCollector,
  ClaudeUsageSourceError,
  CodexUsageCollector,
  CodexRateLimitsSourceError,
} from '../src/index.js'

test('known collector failures become safe non-active snapshots', async () => {
  const observedAtMs = 1234
  const codex = await new CodexUsageCollector({
    async read() { throw new CodexRateLimitsSourceError('raw credential path must not escape', 'LOGIN_REQUIRED') },
  }).collect(observedAtMs)
  const claude = await new ClaudeUsageCollector({
    async read() { throw new ClaudeUsageSourceError('vendor stderr must not escape', 'UNAVAILABLE') },
  }).collect(observedAtMs)
  const antigravity = await new AntigravityUsageCollector({
    async read() { throw new AntigravityUsageSourceError('agy raw failure must not escape', 'UNSUPPORTED') },
  }).collect(observedAtMs)

  assert.deepEqual([codex.status, claude.status, antigravity.status], [
    'LOGIN_REQUIRED',
    'UNAVAILABLE',
    'UNSUPPORTED',
  ])
  for (const snapshot of [codex, claude, antigravity]) {
    assert.deepEqual(snapshot.windows, [])
    assert.doesNotMatch(JSON.stringify(snapshot), /credential path|vendor stderr|agy raw failure/)
  }
})

test('unknown collector failures collapse to ERROR without raw error details', async () => {
  const snapshots = await Promise.all([
    new CodexUsageCollector({ async read() { throw new Error('codex secret stderr') } }).collect(1),
    new ClaudeUsageCollector({ async read() { throw new Error('claude secret stderr') } }).collect(1),
    new AntigravityUsageCollector({ async read() { throw new Error('agy secret stderr') } }).collect(1),
  ])

  for (const snapshot of snapshots) {
    assert.equal(snapshot.status, 'ERROR')
    assert.deepEqual(snapshot.windows, [])
    assert.doesNotMatch(JSON.stringify(snapshot), /secret stderr/)
  }
})
