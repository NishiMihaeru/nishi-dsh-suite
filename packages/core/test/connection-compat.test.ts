import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { registerConnectionRpcChannel } from '../src/host/connection-compat.ts'

const handler: ConnectionRpcHandler = async () => ({ ok: true, value: null })

test('registers the channel through the alpha.1 authenticated two-argument Connection handle', () => {
  const calls: unknown[][] = []
  const rpc = {
    handle(channel: string, receivedHandler: ConnectionRpcHandler) {
      calls.push([channel, receivedHandler])
      return async () => {}
    },
  }

  registerConnectionRpcChannel(rpc as any, '/fixture', handler)

  assert.equal(rpc.handle.length, 2)
  assert.deepEqual(calls, [['/fixture', handler]])
})
