import assert from 'node:assert/strict'
import test from 'node:test'
import { settledStderr } from '../src/runtime/stderr.ts'

interface FakeOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

function fakeHandle(options: { text?: string; readFromThrows?: boolean } = {}) {
  let resolveDone!: (outcome: FakeOutcome) => void
  const done = new Promise<FakeOutcome>((resolve) => {
    resolveDone = resolve
  })
  return {
    handle: {
      pid: 123,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stderr: {
          readFrom() {
            if (options.readFromThrows) throw new Error('boom')
            return { text: options.text ?? '', nextOffset: 0, lossy: false }
          },
        },
      },
      done,
    } as any,
    settle(outcome: FakeOutcome = { exitCode: 0, signal: null }) {
      resolveDone(outcome)
    },
  }
}

test('settledStderr reads the collected stderr tail once the process settles', async () => {
  const fake = fakeHandle({ text: 'the vendor CLI explanation' })
  const promise = settledStderr(fake.handle, 1_000)
  fake.settle()

  assert.equal(await promise, 'the vendor CLI explanation')
})

test('settledStderr falls back to a bounded wait when the process never settles', async () => {
  const fake = fakeHandle({ text: 'late-arriving explanation' })
  const text = await settledStderr(fake.handle, 20)

  assert.equal(text, 'late-arriving explanation')
})

test('settledStderr returns undefined when no stderr reader is present', async () => {
  const handle = {
    pid: 1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done: Promise.resolve({ exitCode: 0, signal: null }),
  } as any

  assert.equal(await settledStderr(handle, 10), undefined)
})

test('settledStderr swallows a throwing stderr reader and returns undefined', async () => {
  const fake = fakeHandle({ readFromThrows: true })
  fake.settle()

  assert.equal(await settledStderr(fake.handle, 10), undefined)
})

test('settledStderr rejects a non-positive graceMs', async () => {
  const fake = fakeHandle()
  await assert.rejects(
    settledStderr(fake.handle, 0),
    /graceMs must be a positive safe integer/,
  )
})

test('settledStderr rejects a graceMs above MAX_TIMER_DELAY_MS', async () => {
  const fake = fakeHandle()
  await assert.rejects(
    settledStderr(fake.handle, 2 ** 32),
    /graceMs must be no greater than/,
  )
})
