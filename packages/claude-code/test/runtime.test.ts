import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { executeClaudeCli } from '../src/run.js'

function fakeChild() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  let settled = false
  let resolveDone!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveDone = resolve
  })
  let terminateCalls = 0
  let waitForExitCalls = 0

  const settle = (outcome = { exitCode: null, signal: 'SIGTERM' as NodeJS.Signals }) => {
    if (settled) return
    settled = true
    resolveDone(outcome)
  }

  return {
    handle: {
      pid: 9911,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate() {
        terminateCalls += 1
        settle()
      },
      async waitForExit() {
        waitForExitCalls += 1
        await done
        return true
      },
    } as any,
    stdout,
    get terminateCalls() {
      return terminateCalls
    },
    get waitForExitCalls() {
      return waitForExitCalls
    },
  }
}

test('direct Claude execution returns after terminal result and then tears down a still-live child', { timeout: 2_000 }, async () => {
  const child = fakeChild()
  const spawned: any[] = []

  const resultPromise = executeClaudeCli({
    cwd: '/workspace',
    executable: '/usr/bin/claude',
    model: 'claude-sonnet-5',
    effort: 'high',
    permissionMode: 'auto',
    prompt: 'delegated task',
    env: {},
    disposeGraceMs: 100,
    spawn(spec: any) {
      spawned.push(spec)
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'answer' }] },
        })}\n`)
        child.stdout.write(`${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
        })}\n`)
      })
      return child.handle
    },
  }, new AbortController().signal)

  const result = await resultPromise
  assert.deepEqual(result, {
    output: [{ type: 'text', text: 'answer' }],
    stopReason: 'completed',
  })
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].argv[0], '/usr/bin/claude')
  assert.ok(spawned[0].argv.includes('--output-format'))
  assert.ok(spawned[0].argv.includes('stream-json'))
  assert.equal(child.terminateCalls, 1)
  assert.equal(child.waitForExitCalls, 1)
})

test('aborting a direct Claude execution terminates the managed child', { timeout: 2_000 }, async () => {
  const child = fakeChild()
  const controller = new AbortController()

  const result = executeClaudeCli({
    cwd: '/workspace',
    executable: '/usr/bin/claude',
    model: 'claude-sonnet-5',
    effort: 'high',
    permissionMode: 'auto',
    prompt: 'delegated task',
    env: {},
    disposeGraceMs: 100,
    spawn() {
      setImmediate(() => controller.abort(new Error('cancelled by test')))
      return child.handle
    },
  }, controller.signal)

  await assert.rejects(result, /abort|cancel/i)
  assert.equal(child.terminateCalls, 1)
  assert.equal(child.waitForExitCalls, 1)
})
