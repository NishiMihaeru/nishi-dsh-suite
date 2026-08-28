import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_BEGIN_LOGIN_ENDPOINT,
  AUTH_GET_STATUS_ENDPOINT,
  AUTH_LOGOUT_ENDPOINT,
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

test('authorization status reports a safe ERROR state when credential storage cannot be read', async () => {
  const secret = 'credential-store-path-or-token-that-must-not-cross-rpc'
  const controller = new AuthorizationHostController({
    credentials: {
      describeRecord: async () => {
        throw new Error(secret)
      },
    },
  } as any)

  const flow = await controller.describeProviderPublic('openai-codex')

  assert.equal(flow.providerId, 'openai-codex')
  assert.equal(flow.configured, false)
  assert.equal(flow.credentialKind, undefined)
  assert.equal(flow.status, 'ERROR')
  assert.equal(flow.lastError, 'Authorization state is unavailable.')
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

test('legacy logout rpc rejects the unsafe destructive path before touching credential storage', async () => {
  let describeCalls = 0
  let deleteCalls = 0
  const controller = new AuthorizationHostController({
    credentials: {
      describeRecord: async () => {
        describeCalls += 1
        return { configured: true, kind: 'grant' }
      },
      deleteRecord: async () => {
        deleteCalls += 1
      },
    },
  } as any)
  const handler = createAuthorizationRpcHandler(controller)

  const result = await handler(
    AUTH_LOGOUT_ENDPOINT,
    { providerId: 'openai-codex' },
    signal,
  )

  assert.equal(describeCalls, 0)
  assert.equal(deleteCalls, 0)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'bad-request')
  assert.equal(result.error.message, 'Invalid authorization request.')
})
