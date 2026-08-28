import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { registerConnectionRpcChannel } from '../src/host/connection-compat.ts'

const handler: ConnectionRpcHandler = async () => ({ ok: true, value: null })

test('alpha.1-style two-argument Connection handle receives no legacy authority argument', () => {
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

test('rc.2-style three-argument Connection handle keeps the trusted-host policy', () => {
  const calls: unknown[][] = []
  const rpc = {
    handle(
      channel: string,
      receivedHandler: ConnectionRpcHandler,
      options: { authority: 'trusted-host' },
    ) {
      calls.push([channel, receivedHandler, options])
      return async () => {}
    },
  }

  registerConnectionRpcChannel(rpc as any, '/fixture', handler)

  assert.equal(rpc.handle.length, 3)
  assert.deepEqual(calls, [[
    '/fixture',
    handler,
    { authority: 'trusted-host' },
  ]])
})
