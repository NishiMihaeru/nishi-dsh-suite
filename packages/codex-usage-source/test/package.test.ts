import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { codexAppServerArgv, DEFAULT_REQUEST_TIMEOUT_MS, MAX_PROTOCOL_LINE_BYTES } from '../src/index.js'

test('Codex usage source keeps the public package and pinned official runtime boundary', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'nishi-dsh-codex-usage-source')
  assert.equal(pkg.version, '0.1.0-rc.1')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.dependencies['@openai/codex'], '0.147.0')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-subprocess'], '0.1.1-rc.2')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-timeout'], '0.1.1-rc.2')
})

test('explicit executable uses only the official app-server stdio command', () => {
  assert.deepEqual(codexAppServerArgv(process.platform, '/vendor/codex'), [
    '/vendor/codex',
    'app-server',
    '--stdio',
  ])
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 30_000)
  assert.equal(MAX_PROTOCOL_LINE_BYTES, 1024 * 1024)
})
