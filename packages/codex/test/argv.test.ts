import assert from 'node:assert/strict'
import test from 'node:test'
import { codexAppServerArgv, CODEX_PACKAGE_BIN } from '../src/run.js'

test('argv contract: package-local launch spec has exact controlled flags in correct order', () => {
  const argv = codexAppServerArgv()

  assert.equal(argv[0], process.execPath)
  assert.equal(argv[1], CODEX_PACKAGE_BIN)
  assert.deepEqual(argv.slice(2), [
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

test('argv contract: does not use Windows cmd.exe shim in rc.2', () => {
  const argv = codexAppServerArgv()
  assert.equal(argv.includes('cmd.exe'), false)
})

test('argv contract: exact cardinality, order, and absence of prohibited parameters', () => {
  const argv = codexAppServerArgv()

  // 1. All three -c flags exist exactly once
  const useMemoriesCount = argv.filter((a) => a === 'memories.use_memories=false').length
  const genMemoriesCount = argv.filter((a) => a === 'memories.generate_memories=false').length
  const projectDocCount = argv.filter((a) => a === 'project_doc_max_bytes=0').length

  assert.equal(useMemoriesCount, 1, 'memories.use_memories=false must appear exactly once')
  assert.equal(genMemoriesCount, 1, 'memories.generate_memories=false must appear exactly once')
  assert.equal(projectDocCount, 1, 'project_doc_max_bytes=0 must appear exactly once')

  // Count -c occurrences: exactly 3
  const cFlagCount = argv.filter((a) => a === '-c').length
  assert.equal(cFlagCount, 3, '-c flag must appear exactly 3 times')

  // 2. Overrides occur before app-server
  const appServerIndex = argv.indexOf('app-server')
  assert.ok(appServerIndex > 0, 'app-server must be present')

  const useMemIdx = argv.indexOf('memories.use_memories=false')
  const genMemIdx = argv.indexOf('memories.generate_memories=false')
  const projDocIdx = argv.indexOf('project_doc_max_bytes=0')

  assert.ok(useMemIdx < appServerIndex, 'memories.use_memories=false must precede app-server')
  assert.ok(genMemIdx < appServerIndex, 'memories.generate_memories=false must precede app-server')
  assert.ok(projDocIdx < appServerIndex, 'project_doc_max_bytes=0 must precede app-server')

  // 3. app-server occurs exactly once
  const appServerCount = argv.filter((a) => a === 'app-server').length
  assert.equal(appServerCount, 1, 'app-server must appear exactly once')

  // 4. --stdio occurs exactly once
  const stdioCount = argv.filter((a) => a === '--stdio').length
  assert.equal(stdioCount, 1, '--stdio must appear exactly once')

  // 5. No CODEX_HOME override in argv
  const codexHomeArgs = argv.filter((a) => a.includes('CODEX_HOME'))
  assert.equal(codexHomeArgs.length, 0, 'argv must contain no CODEX_HOME overrides')

  // 6. No model prompt or arbitrary config text
  const promptArgs = argv.filter((a) => a.includes('prompt') || a.includes('turn/start'))
  assert.equal(promptArgs.length, 0, 'argv must contain no prompt content')
})
