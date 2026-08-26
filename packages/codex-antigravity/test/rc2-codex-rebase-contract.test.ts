import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  codexAppServerArgv,
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexStartupFailure,
} from '../src/run.js'
import { name } from '../src/index.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

test('CODEX REBASE: public package identity and pinned Codex runtime/search SDK are exact', async () => {
  const manifestRaw = await readFile(join(packageDir, 'package.json'), 'utf8')
  const manifest = JSON.parse(manifestRaw)

  assert.equal(manifest.name, 'nishi-dsh-codex-antigravity')
  assert.equal(manifest.version, '0.1.0-rc.1')
  assert.equal(manifest.dependencies?.['@openai/codex'], '0.147.0')
  assert.equal(manifest.dependencies?.['@openai/codex-sdk'], '0.147.0')
  assert.ok(manifest.peerDependencies?.['@deepseek-ai/dsh-subprocess'])
  assert.ok(manifest.peerDependencies?.['@deepseek-ai/dsh-tools'])
  assert.ok(manifest.peerDependencies?.['@deepseek-ai/dsh-system-prompt'])
})

test('CODEX REBASE: README documents upstream rc.2 provenance and commit SHA', async () => {
  const readme = await readFile(join(packageDir, 'README.md'), 'utf8')
  assert.ok(
    readme.includes('0.1.1-rc.2') || readme.includes('b150a551'),
    'README must document rc.2 upstream reference provenance',
  )
})

test('CODEX REBASE: codexAppServerArgv uses package-local wrapper without Windows cmd.exe shim', () => {
  const argv = codexAppServerArgv()

  assert.equal(argv[0], process.execPath, 'Argv must begin with process.execPath')
  assert.ok(
    argv[1].includes('@openai') && argv[1].includes('codex'),
    'Argv[1] must point to package-local codex binary wrapper',
  )
  assert.equal(argv.includes('cmd.exe'), false, 'Argv must NOT use Windows cmd.exe shim in rc.2 rebase')

  const appServerIdx = argv.indexOf('app-server')
  assert.ok(appServerIdx > 0, 'Argv must contain "app-server"')
  assert.equal(argv[appServerIdx + 1], '--stdio')

  const prefixStr = argv.slice(2, appServerIdx).join(' ')
  assert.ok(prefixStr.includes('memories.use_memories=false'))
  assert.ok(prefixStr.includes('memories.generate_memories=false'))
  assert.ok(prefixStr.includes('project_doc_max_bytes=0'))
})

test('CODEX REBASE: permission modes and defaults align with rc.2 stock', () => {
  assert.deepEqual(CODEX_PERMISSION_MODES, [
    'never',
    'approve-for-me',
    'dangerously-bypass-approvals-and-sandbox',
  ])
  assert.equal(DEFAULT_CODEX_PERMISSION_MODE, 'never')
  assert.equal(DEFAULT_DISPOSE_GRACE_MS, 3000)
  assert.equal(name, 'subagent-codex')
})

test('CODEX REBASE: failure diagnostic hides unauthenticated host error behind safe facts', () => {
  const err = codexStartupFailure(new Error('Sensitive path C:\\Users\\<user>'))
  assert.ok(err.message.includes('subagent-codex:'))
  assert.equal(err.message.includes('C:\\Users\\<user>'), false)
})
