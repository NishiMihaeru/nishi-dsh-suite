import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  claudeQueryOptions,
  consumeClaudeQuery,
  disposeClaudeCodeChild,
  successfulResult,
  textTask,
  ClaudeCodeFailure,
} from '../src/run.js'
import { ManagedClaudeCodeProcess } from '../src/process.js'

interface FakeOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

function fakeChild(options: {
  pid?: number
  waitForExitError?: Error
  doneError?: Error
} = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let resolveDone!: (outcome: FakeOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<FakeOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  void done.catch(() => {})

  let terminateCalls = 0
  let waitForExitCalls = 0
  const terminate = () => {
    terminateCalls += 1
  }
  const waitForExit = async () => {
    waitForExitCalls += 1
    if (options.waitForExitError !== undefined) {
      throw options.waitForExitError
    }
    return true
  }

  if (options.doneError !== undefined) {
    rejectDone(options.doneError)
  }

  return {
    handle: {
      pid: options.pid ?? 1234,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate,
      waitForExit,
    } as any,
    settle(outcome: FakeOutcome = { exitCode: 0, signal: null }) {
      resolveDone(outcome)
    },
    fail(error: Error) {
      rejectDone(error)
    },
    get terminateCalls() {
      return terminateCalls
    },
    get waitForExitCalls() {
      return waitForExitCalls
    },
  }
}

function sdkSpawnOptions(overrides: Record<string, unknown> = {}) {
  return {
    command: '/sdk/claude',
    args: ['--output-format', 'stream-json'],
    cwd: '/workspace',
    env: { PATH: '/bin' },
    signal: new AbortController().signal,
    ...overrides,
  } as any
}

function success(result = 'answer', isError = false) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: isError,
    result,
  } as any
}

function failure(subtype = 'error_during_execution', errors: string[] = ['fixture failure']) {
  return {
    type: 'result',
    subtype,
    is_error: true,
    result: '',
    errors,
  } as any
}

async function* queryFrom(messages: any[]) {
  for (const message of messages) {
    yield message
  }
}

test('textTask validates one-shot prompt content', () => {
  assert.throws(
    () => textTask([]),
    /one-shot task must contain only text blocks/i,
  )

  assert.throws(
    () => textTask([{ type: 'image' } as any]),
    /one-shot task must contain only text blocks/i,
  )

  assert.throws(
    () => textTask([{ type: 'text', text: '   \n\t  ' }]),
    /one-shot task must not be empty/i,
  )

  assert.equal(
    textTask([
      { type: 'text', text: 'alpha ' },
      { type: 'text', text: 'beta' },
    ]),
    'alpha beta',
  )
})

test('successfulResult only accepts strict non-error success', () => {
  assert.equal(successfulResult(success('valid result')), 'valid result')

  assert.throws(
    () => successfulResult(success('error text', true)),
    (err: any) => err instanceof ClaudeCodeFailure && err.facts.category === 'invalid-success',
  )

  assert.throws(
    () => successfulResult(success('   \n  ', false)),
    (err: any) => err instanceof ClaudeCodeFailure && err.facts.category === 'invalid-success',
  )

  assert.throws(
    () => successfulResult(failure('error_max_turns', ['turns exhausted'])),
    (err: any) => err instanceof ClaudeCodeFailure && err.facts.category === 'error_max_turns',
  )
})

test('complete stream consumption keeps the latest strict success and requires a result', async () => {
  const result = await consumeClaudeQuery(queryFrom([
    { type: 'system', subtype: 'init' },
    success('first'),
    success('last'),
  ]) as any)
  assert.deepEqual(result, {
    output: [{ type: 'text', text: 'last' }],
    stopReason: 'completed',
  })

  await assert.rejects(
    consumeClaudeQuery(queryFrom([
      { type: 'system', subtype: 'init' },
    ]) as any),
    (err: any) => err instanceof ClaudeCodeFailure && err.facts.category === 'missing-result',
  )
})

test('query options preserve rc.2 unattended defaults and add approved model controls', () => {
  const child = fakeChild()
  const spawnSpecs: any[] = []
  const captured: any[] = []
  const controller = new AbortController()
  const options = claudeQueryOptions(
    {
      cwd: '/workspace',
      env: {
        HOST_VISIBLE: 'overridden',
      },
      model: 'claude-sonnet-5',
      effort: 'high',
      permissionMode: 'auto',
      disposeGraceMs: 17,
      spawn: (spec: any) => {
        spawnSpecs.push(spec)
        return child.handle
      },
    } as any,
    controller,
    (c, p) => {
      captured.push({ c, p })
    },
    () => {},
  )

  assert.equal(options.abortController, controller)
  assert.equal(options.cwd, '/workspace')
  assert.equal(options.persistSession, false)
  assert.deepEqual(options.disallowedTools, ['AskUserQuestion'])
  assert.equal((options as any).model, 'claude-sonnet-5')
  assert.equal((options as any).effort, 'high')
  assert.equal(options.permissionMode, 'auto')

  const spawned = options.spawnClaudeCodeProcess!(sdkSpawnOptions())
  assert.equal(spawned instanceof ManagedClaudeCodeProcess, true)
  assert.equal(captured.length, 1)
  assert.equal(spawnSpecs.length, 1)
  assert.deepEqual(spawnSpecs[0].argv, [
    '/sdk/claude',
    '--output-format',
    'stream-json',
  ])
  assert.equal(spawnSpecs[0].cwd, '/workspace')
  assert.equal(spawnSpecs[0].graceMs, 17)
})

test('cleanup closes the query, terminates the managed tree, waits for exit and done', async () => {
  const child = fakeChild()
  child.settle()
  let closeCalls = 0
  await disposeClaudeCodeChild({
    close() {
      closeCalls += 1
    },
  } as any, child.handle)

  assert.equal(closeCalls, 1)
  assert.equal(child.terminateCalls, 1)
  assert.equal(child.waitForExitCalls, 1)
})
