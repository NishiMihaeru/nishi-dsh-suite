import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
  sdkEnvironmentOverlay,
} from '../src/process.js'

interface FakeOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function fakeChild(options: { exitOnTerminate?: boolean } = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let settled = false
  let resolveDone!: (outcome: FakeOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<FakeOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  void done.catch(() => {})

  const settle = (outcome: FakeOutcome = { exitCode: 0, signal: null }) => {
    if (settled) return
    settled = true
    resolveDone(outcome)
  }
  const fail = (error: Error) => {
    if (settled) return
    settled = true
    rejectDone(error)
  }
  let terminateCalls = 0
  const terminate = () => {
    terminateCalls += 1
    if (options.exitOnTerminate !== false) settle()
  }

  return {
    handle: {
      pid: 1234,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate,
      async waitForExit() {
        await done.catch(() => {})
        return true
      },
    } as any,
    stdin,
    stdout,
    settle,
    fail,
    get terminateCalls() {
      return terminateCalls
    },
  }
}

function sdkSpawnOptions(overrides: Record<string, unknown> = {}) {
  return {
    command: '/sdk/claude',
    args: ['--output-format', 'stream-json'],
    cwd: '/workspace',
    env: { PATH: '/bin', OMITTED: undefined },
    signal: new AbortController().signal,
    ...overrides,
  } as any
}

test('SDK environment is projected as an overlay with tombstones for removed ambient values', () => {
  const previous = process.env.SDK_REMOVED_AMBIENT
  process.env.SDK_REMOVED_AMBIENT = 'ambient-value'
  try {
    const overlay = sdkEnvironmentOverlay({
      A: 'one',
      B: undefined,
      C: 'three',
    })
    assert.equal(overlay.A, 'one')
    assert.equal(overlay.B, undefined)
    assert.equal(overlay.C, 'three')
    assert.equal(overlay.SDK_REMOVED_AMBIENT, undefined)
  } finally {
    if (previous === undefined) delete process.env.SDK_REMOVED_AMBIENT
    else process.env.SDK_REMOVED_AMBIENT = previous
  }
})

test('spawn projection preserves executable, argv, cwd, signal, stdio, grace and environment', () => {
  const signal = new AbortController().signal
  const spec = claudeSpawnSpec(
    sdkSpawnOptions({
      command: '/official/claude',
      args: ['--one', 'two'],
      cwd: '/parent/workspace',
      env: { A: 'one', B: undefined, C: 'three' },
      signal,
    }),
    321,
  )

  assert.deepEqual(spec.argv, ['/official/claude', '--one', 'two'])
  assert.equal(spec.cwd, '/parent/workspace')
  assert.deepEqual(spec.stdio, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  assert.equal(spec.graceMs, 321)
  assert.equal(spec.signal, signal)
  assert.equal(spec.env?.A, 'one')
  assert.equal(spec.env?.B, undefined)
  assert.equal(spec.env?.C, 'three')
})

test('spawn projection rejects missing or empty SDK cwd', () => {
  const missing = sdkSpawnOptions()
  delete missing.cwd
  assert.throws(() => claudeSpawnSpec(missing, 7), /SDK spawn request omitted its workspace/)
  assert.throws(
    () => claudeSpawnSpec(sdkSpawnOptions({ cwd: '' }), 7),
    /SDK spawn request omitted its workspace/,
  )
})

test('managed process projects streams, exit state, listeners and idempotent tree termination', async () => {
  const child = fakeChild({ exitOnTerminate: false })
  const managed = new ManagedClaudeCodeProcess(child.handle)

  assert.equal(managed.stdin, child.stdin)
  assert.equal(managed.stdout, child.stdout)
  assert.equal(managed.killed, false)
  assert.equal(managed.exitCode, null)
  assert.equal(managed.signalCode, null)

  const exits: Array<[number | null, NodeJS.Signals | null]> = []
  let onceCalls = 0
  let removedCalls = 0
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exits.push([code, signal])
  }
  const onceExit = () => {
    onceCalls += 1
  }
  const removed = () => {
    removedCalls += 1
  }

  managed.on('exit', onExit)
  managed.once('exit', onceExit)
  managed.on('exit', removed)
  managed.off('exit', removed)

  assert.equal(managed.kill('SIGTERM'), true)
  assert.equal(managed.killed, true)
  assert.equal(managed.kill('SIGKILL'), false)
  assert.equal(child.terminateCalls, 1)

  child.settle({ exitCode: null, signal: 'SIGTERM' })
  await nextTask()

  assert.deepEqual(exits, [[null, 'SIGTERM']])
  assert.equal(onceCalls, 1)
  assert.equal(removedCalls, 0)
  assert.equal(managed.exitCode, null)
  assert.equal(managed.signalCode, 'SIGTERM')
  assert.equal(managed.kill('SIGTERM'), false)
})

test('managed process emits child spawn failures through the SDK error event', async () => {
  const child = fakeChild()
  const managed = new ManagedClaudeCodeProcess(child.handle)
  const messages: string[] = []
  let removedCalls = 0
  const onError = (error: Error) => {
    messages.push(error.message)
  }
  const removed = () => {
    removedCalls += 1
  }

  managed.once('error', onError)
  managed.on('error', removed)
  managed.off('error', removed)
  child.fail(new Error('spawn boom'))
  await nextTask()

  assert.deepEqual(messages, ['spawn boom'])
  assert.equal(removedCalls, 0)
})

test('managed process exposes a settled direct-child exit code and refuses late kill', async () => {
  const child = fakeChild()
  const managed = new ManagedClaudeCodeProcess(child.handle)
  child.settle({ exitCode: 7, signal: null })
  await nextTask()

  assert.equal(managed.exitCode, 7)
  assert.equal(managed.signalCode, null)
  assert.equal(managed.kill('SIGTERM'), false)
  assert.equal(child.terminateCalls, 0)
})
