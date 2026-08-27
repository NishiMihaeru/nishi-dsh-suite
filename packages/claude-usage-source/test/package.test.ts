import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  MAX_CLAUDE_STREAM_LINE_BYTES,
  claudeUsageCliArgv,
} from '../src/index.js'

test('Claude usage source keeps the public package without a bundled Claude runtime', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'nishi-dsh-claude-usage-source')
  assert.equal(pkg.version, '0.1.0-rc.2')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-subprocess'], '0.1.1-rc.2')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-timeout'], '0.1.1-rc.2')
})

test('no source file reaches for a vendored Anthropic runtime', async () => {
  const dir = new URL('../src/', import.meta.url)
  const entries = (await readdir(dir)).filter((entry) => entry.endsWith('.ts'))
  assert.ok(entries.length >= 4, 'expected the ported source set to be present')
  for (const entry of entries) {
    const source = await readFile(new URL(entry, dir), 'utf8')
    assert.doesNotMatch(source, /@anthropic-ai\//, entry)
    assert.doesNotMatch(source, /claude-agent-sdk/, entry)
  }
})

test('the usage package carries no agent-path module graph', async () => {
  const entries = await readdir(new URL('../src/', import.meta.url))
  assert.deepEqual(
    entries.filter((entry) => entry.endsWith('.ts')).sort(),
    ['executable.ts', 'index.ts', 'process.ts', 'usage.ts'],
  )
})

test('public surface pins the control-session contract', () => {
  assert.deepEqual(claudeUsageCliArgv('/vendor/claude'), [
    '/vendor/claude',
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--tools', '',
    '--strict-mcp-config',
  ])
  assert.equal(DEFAULT_USAGE_REQUEST_TIMEOUT_MS, 30_000)
  assert.equal(DEFAULT_DISPOSE_GRACE_MS, 3000)
  assert.equal(MAX_CLAUDE_STREAM_LINE_BYTES, 1024 * 1024)
})
