import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_BEGIN_LOGIN_ENDPOINT,
  AUTH_GET_STATUS_ENDPOINT,
  AuthorizationHostController,
  createAuthorizationRpcHandler,
} from '../src/host/authorization-rpc.js'

const signal = new AbortController().signal

test('authorization status exposes credential kind but never credential material', async () => {
  const secret = 'oauth-access-token-that-must-not-cross-rpc'
  const controller = new AuthorizationHostController({
    credentials: {
      describeRecord: async () => ({ configured: true, kind: 'grant', accessToken: secret }),
    },
  } as any)

  const flow = await controller.describeProviderPublic('openai-codex')

  assert.equal(flow.providerId, 'openai-codex')
  assert.equal(flow.configured, true)
  assert.equal(flow.credentialKind, 'grant')
  assert.equal(flow.status, 'CONNECTED')
  assert.ok(!JSON.stringify(flow).includes(secret))
})

test('authorization rpc refuses DSH-managed subscription login', async () => {
  let beginCalled = false
  const controller = new AuthorizationHostController({} as any)
  ;(controller as any).beginLogin = async () => {
    beginCalled = true
    throw new Error('must not run')
  }
  const handler = createAuthorizationRpcHandler(controller)

  const result = await handler(
    AUTH_BEGIN_LOGIN_ENDPOINT,
    { providerId: 'openai-codex', method: 'oauth' },
    signal,
  )

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'bad-request')
  assert.equal(result.error.message, 'Invalid authorization request.')
  assert.equal(beginCalled, false)
})

test('authorization rpc converts host failures to generic errors', async () => {
  const secret = 'local-path-or-token-secret'
  const controller = new AuthorizationHostController({} as any)
  ;(controller as any).describeProviderPublic = async () => {
    throw new Error(secret)
  }
  const handler = createAuthorizationRpcHandler(controller)

  const result = await handler(
    AUTH_GET_STATUS_ENDPOINT,
    { providerId: 'openai-codex' },
    signal,
  )

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'internal')
  assert.equal(result.error.message, 'Authorization operation failed.')
  assert.ok(!JSON.stringify(result).includes(secret))
})
