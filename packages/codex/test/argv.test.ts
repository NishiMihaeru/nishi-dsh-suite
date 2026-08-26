import assert from 'node:assert/strict'
import test from 'node:test'
import { codexAppServerArgv } from '../src/run.js'

const EXTERNAL_CODEX = '/home/user/.local/bin/codex'

test('argv contract: external codex launch spec has exact controlled flags in correct order', () => {
  const argv = codexAppServerArgv(EXTERNAL_CODEX)

  assert.deepEqual(argv, [
    EXTERNAL_CODEX,
    '-c',
    'memories.use_memories=false',
    '-c',
    'memories.generate_memories=false',
    '-c',
    'project_doc_max_bytes=0',
    'app-server',
    '--stdio',
  ])
})

test('argv contract: invokes the resolved executable directly', () => {
  const argv = codexAppServerArgv(EXTERNAL_CODEX)

  assert.equal(argv[0], EXTERNAL_CODEX)
  assert.equal(argv.includes(process.execPath), false)
  assert.equal(argv.includes('cmd.exe'), false)
})

test('argv contract: exact cardinality, order, and absence of prohibited parameters', () => {
  const argv = codexAppServerArgv(EXTERNAL_CODEX)

  const useMemoriesCount = argv.filter((arg) => arg === 'memories.use_memories=false').length
  const genMemoriesCount = argv.filter((arg) => arg === 'memories.generate_memories=false').length
  const projectDocCount = argv.filter((arg) => arg === 'project_doc_max_bytes=0').length

  assert.equal(useMemoriesCount, 1, 'memories.use_memories=false must appear exactly once')
  assert.equal(genMemoriesCount, 1, 'memories.generate_memories=false must appear exactly once')
  assert.equal(projectDocCount, 1, 'project_doc_max_bytes=0 must appear exactly once')
  assert.equal(argv.filter((arg) => arg === '-c').length, 3, '-c flag must appear exactly 3 times')

  const appServerIndex = argv.indexOf('app-server')
  assert.ok(appServerIndex > 0, 'app-server must be present')
  assert.ok(argv.indexOf('memories.use_memories=false') < appServerIndex)
  assert.ok(argv.indexOf('memories.generate_memories=false') < appServerIndex)
  assert.ok(argv.indexOf('project_doc_max_bytes=0') < appServerIndex)
  assert.equal(argv.filter((arg) => arg === 'app-server').length, 1)
  assert.equal(argv.filter((arg) => arg === '--stdio').length, 1)
  assert.equal(argv.some((arg) => arg.includes('CODEX_HOME')), false)
  assert.equal(argv.some((arg) => arg.includes('prompt') || arg.includes('turn/start')), false)
})
