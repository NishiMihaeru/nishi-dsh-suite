import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { CodexAppServerConnection } from '../src/codex-plugin-dsh/app-server.ts'

test('concurrent close callers all wait for the same whole-tree shutdown', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  const treeGone = Promise.withResolvers<void>()
  let terminateCalls = 0
  let waitCalls = 0

  const child = {
    pid: 4321,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done: done.promise,
    terminate() {
      terminateCalls += 1
    },
    async waitForExit() {
      waitCalls += 1
      await treeGone.promise
      return true
    },
  } as any

  const connection = new CodexAppServerConnection(
    child,
    async () => { throw new Error('request handler must not be reached') },
  )

  const first = connection.close()
  let secondSettled = false
  const second = connection.close().then(() => { secondSettled = true })

  await Promise.resolve()
  assert.equal(secondSettled, false, 'a concurrent close must not return before the tree is gone')
  assert.equal(terminateCalls, 1)
  assert.equal(waitCalls, 1)

  done.resolve({ exitCode: 0, signal: null })
  treeGone.resolve()
  await Promise.all([first, second])
  assert.equal(secondSettled, true)
})
