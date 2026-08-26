import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Claude Code package manifest has independent public identity and SDK pin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'nishi-dsh-claude-code')
  assert.equal(manifest.version, '0.1.0-rc.1')
  assert.equal(manifest.dependencies?.['@anthropic-ai/claude-agent-sdk'], '0.3.220')
  assert.equal(manifest.exports?.['./usage']?.default, './lib/usage.js')
})

test('Claude Code invariant owns nishi-dsh-claude-code', async () => {
  const invariant = await import('../src/invariant.ts')
  let owner = ''
  const dispose = () => {}
  const ctx = { invariants: { register(name: string) { owner = name; return dispose } } }
  assert.equal(await invariant.apply(ctx as any), dispose)
  assert.equal(owner, 'nishi-dsh-claude-code')
})

test('Claude Code README documents native auth boundary and read-only memory tool', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /claude-sonnet-5/)
  assert.match(readme, /effort `high`/)
  assert.match(readme, /permission mode `auto`/)
  assert.match(readme, /mcp__dsh-memory__memory_read/)
  assert.match(readme, /vendor-owned/)
})
