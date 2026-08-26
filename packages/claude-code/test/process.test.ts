import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  claudeOutputLines,
  disposeClaudeCliChild,
  MAX_CLAUDE_STREAM_LINE_BYTES,
} from '../src/process.js'

interface FakeOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

function fakeChild() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  let settled = false
  let resolveDone!: (outcome: FakeOutcome) => void
  const done = new Promise<FakeOutcome>((resolve) => {
    resolveDone = resolve
  })
  let terminateCalls = 0
  let waitForExitCalls = 0

  const settle = (outcome: FakeOutcome = { exitCode: 0, signal: null }) => {
    if (settled) return
    settled = true
    resolveDone(outcome)
  }

  return {
    handle: {
      pid: 4321,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate() {
        terminateCalls += 1
        settle({ exitCode: null, signal: 'SIGTERM' })
      },
      async waitForExit() {
        waitForExitCalls += 1
        await done
        return true
      },
    } as any,
    stdout,
    settle,
    get terminateCalls() {
      return terminateCalls
    },
    get waitForExitCalls() {
      return waitForExitCalls
    },
  }
}

async function collectLines(stream: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = []
  for await (const line of stream) result.push(line)
  return result
}

test('Claude stdout decoder handles fragmented NDJSON without changing payload text', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(claudeOutputLines(stdout))

  stdout.write('{"type":"assistant"')
  stdout.write('}\n{"type":"result"}\n')
  stdout.end()

  assert.deepEqual(await collected, [
    '{"type":"assistant"}',
    '{"type":"result"}',
  ])
})

test('Claude stdout decoder rejects a protocol line larger than the fixed bound', async () => {
  const stdout = new PassThrough()
  const collected = collectLines(claudeOutputLines(stdout))
  stdout.end(`${'x'.repeat(MAX_CLAUDE_STREAM_LINE_BYTES + 1)}\n`)

  await assert.rejects(collected, /stream line.*maximum/i)
})

test('Claude CLI cleanup terminates the managed tree and waits for quiescence', async () => {
  const child = fakeChild()
  const outcome = await disposeClaudeCliChild(child.handle)

  assert.equal(child.terminateCalls, 1)
  assert.equal(child.waitForExitCalls, 1)
  assert.deepEqual(outcome, { exitCode: null, signal: 'SIGTERM' })
})
