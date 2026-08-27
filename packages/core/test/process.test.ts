import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { disposeVendorChild, outputLines } from '../src/runtime/process.ts'

interface FakeOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

function fakeChild(overrides: { pid?: number } = {}) {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  let settled = false
  let resolveDone!: (outcome: FakeOutcome) => void
  const done = new Promise<FakeOutcome>((resolve) => {
    resolveDone = resolve
  })
  let terminateCalls = 0
  let waitForExitCalls = 0
  const calls: string[] = []
  const realEnd = stdin.end.bind(stdin)
  stdin.end = ((...args: any[]) => {
    calls.push('stdin.end')
    return realEnd(...args)
  }) as typeof stdin.end

  const settle = (outcome: FakeOutcome = { exitCode: 0, signal: null }) => {
    if (settled) return
    settled = true
    resolveDone(outcome)
  }

  return {
    handle: {
      pid: overrides.pid ?? 4321,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate() {
        calls.push('terminate')
        terminateCalls += 1
        settle({ exitCode: null, signal: 'SIGTERM' })
      },
      async waitForExit() {
        calls.push('waitForExit')
        waitForExitCalls += 1
        await done
        return true
      },
    } as any,
    stdout,
    settle,
    get calls() {
      return calls
    },
    get terminateCalls() {
      return terminateCalls
    },
    get waitForExitCalls() {
      return waitForExitCalls
    },
    get stdinEnded() {
      return stdinEnded
    },
  }
}

async function collectLines(stream: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = []
  for await (const line of stream) result.push(line)
  return result
}

test('outputLines decodes fragmented NDJSON across chunk boundaries without altering payload text', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(outputLines(stdout, 1024))

  stdout.write('{"type":"assistant"')
  stdout.write('}\n{"type":"result"}\n')
  stdout.end()

  assert.deepEqual(await collected, [
    '{"type":"assistant"}',
    '{"type":"result"}',
  ])
})

test('outputLines preserves a UTF-8 code point split across Buffer chunk boundaries', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(outputLines(stdout, 1024))
  const euro = Buffer.from('€', 'utf8')

  assert.equal(euro.length, 3, 'fixture must use a multi-byte UTF-8 code point')
  stdout.write(Buffer.concat([Buffer.from('{"text":"', 'utf8'), euro.subarray(0, 2)]))
  stdout.end(Buffer.concat([euro.subarray(2), Buffer.from('"}\n', 'utf8')]))

  assert.deepEqual(await collected, ['{"text":"€"}'])
})

test('outputLines strips a trailing CR so CRLF streams decode the same as LF streams', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(outputLines(stdout, 1024))
  stdout.end('{"a":1}\r\n{"b":2}\r\n')

  assert.deepEqual(await collected, ['{"a":1}', '{"b":2}'])
})

test('outputLines yields a trailing unterminated line once the stream ends', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(outputLines(stdout, 1024))
  stdout.end('{"a":1}\nno-trailing-newline')

  assert.deepEqual(await collected, ['{"a":1}', 'no-trailing-newline'])
})

test('outputLines rejects a line larger than maxBytes', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(outputLines(stdout, 16))
  stdout.end(`${'x'.repeat(17)}\n`)

  await assert.rejects(collected, /stream line exceeded maximum 16 bytes/)
})

test('outputLines rejects an unterminated remainder larger than maxBytes', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(outputLines(stdout, 8))
  stdout.end('x'.repeat(9))

  await assert.rejects(collected, /stream line exceeded maximum 8 bytes/)
})

test('outputLines rejects a non-positive maxBytes before reading anything', async () => {
  const stdout = new PassThrough()
  await assert.rejects(
    collectLines(outputLines(stdout, 0)),
    /maxBytes must be a positive safe integer/,
  )
})

test('disposeVendorChild terminates the managed tree, waits for exit, and returns the outcome', async () => {
  const child = fakeChild()
  const outcome = await disposeVendorChild(child.handle)

  assert.equal(child.terminateCalls, 1)
  assert.equal(child.waitForExitCalls, 1)
  assert.deepEqual(outcome, { exitCode: null, signal: 'SIGTERM' })
})

test('disposeVendorChild closes stdin before escalating to terminate', async () => {
  const child = fakeChild()
  await disposeVendorChild(child.handle)

  // Order is the point: a vendor CLI that is still reading stdin should be
  // given the chance to exit on its own before it is signalled.
  assert.deepEqual(child.calls, ['stdin.end', 'terminate', 'waitForExit'])
})

test('disposeVendorChild on a spawn-failed handle (pid <= 0) awaits done without terminating', async () => {
  const child = fakeChild({ pid: -1 })
  child.settle({ exitCode: null, signal: null })
  const outcome = await disposeVendorChild(child.handle)

  assert.equal(child.terminateCalls, 0)
  assert.equal(child.waitForExitCalls, 0)
  assert.deepEqual(outcome, { exitCode: null, signal: null })
})

test('disposeVendorChild on a spawn-failed handle swallows a rejected done', async () => {
  const handle = {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done: Promise.reject(new Error('spawn failed')),
    terminate() {
      throw new Error('should not be called')
    },
    async waitForExit() {
      throw new Error('should not be called')
    },
  } as any

  const outcome = await disposeVendorChild(handle)
  assert.equal(outcome, undefined)
})
