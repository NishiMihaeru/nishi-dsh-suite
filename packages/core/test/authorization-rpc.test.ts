import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_GET_FLOWS_ENDPOINT,
  AUTH_GET_STATUS_ENDPOINT,
  AUTH_REFRESH_ENDPOINT,
  AuthorizationHostController,
  createAuthorizationRpcHandler,
} from '../src/host/authorization-rpc.js'

const signal = new AbortController().signal

/** A minimal registered-provider fixture: only `id` and `descriptor.account` matter to the controller. */
function accountProvider(id: string, account?: { credentialScope: string; credentialId: string; label: string }) {
  return { id, descriptor: { account } }
}

test('a provider that declares account gets a Model Accounts row; a provider that does not is absent', async () => {
  const controller = new AuthorizationHostController({
    nishiProviders: {
      all: () => [
        accountProvider('fixture-with-account', { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' }),
        accountProvider('fixture-without-account'),
      ],
    },
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)

  const flows = await controller.listFlowsPublic()

  assert.deepEqual(flows.map((f) => f.providerId), ['fixture-with-account'])
  assert.equal(flows[0]?.label, 'Fixture')
})

test('no provider hardcodes an OpenAI row any more: a roster without an OpenAI-owning provider has no OpenAI row', async () => {
  const controller = new AuthorizationHostController({
    nishiProviders: {
      all: () => [
        accountProvider('codex', { credentialScope: 'llm-pi-ai', credentialId: 'openai-codex', label: 'ChatGPT / Codex' }),
        accountProvider('claude', { credentialScope: 'llm-pi-ai', credentialId: 'anthropic', label: 'Claude (Anthropic)' }),
      ],
    },
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)

  const flows = await controller.listFlowsPublic()

  assert.deepEqual(flows.map((f) => f.providerId).sort(), ['claude', 'codex'])
})

test('authorization status exposes credential kind but never credential material', async () => {
  const secret = 'oauth-access-token-that-must-not-cross-rpc'
  const controller = new AuthorizationHostController({
    nishiProviders: { all: () => [accountProvider('fixture', { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' })] },
    credentials: {
      describeRecord: async () => ({ configured: true, kind: 'grant', accessToken: secret }),
    },
  } as any)

  const flow = await controller.describeProviderPublic('fixture')

  assert.equal(flow?.providerId, 'fixture')
  assert.equal(flow?.configured, true)
  assert.equal(flow?.credentialKind, 'grant')
  assert.equal(flow?.status, 'CONNECTED')
  assert.ok(!JSON.stringify(flow).includes(secret))
})

test('an unconfigured credential record reports NOT_CONFIGURED, not an error', async () => {
  const controller = new AuthorizationHostController({
    nishiProviders: { all: () => [accountProvider('fixture', { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' })] },
    credentials: {
      describeRecord: async () => ({ configured: false }),
    },
  } as any)

  const flow = await controller.describeProviderPublic('fixture')

  assert.equal(flow?.configured, false)
  assert.equal(flow?.credentialKind, undefined)
  assert.equal(flow?.status, 'NOT_CONFIGURED')
  assert.equal(flow?.lastError, undefined)
})

test('authorization status reports a safe ERROR state when credential storage cannot be read', async () => {
  const secret = 'credential-store-path-or-token-that-must-not-cross-rpc'
  const controller = new AuthorizationHostController({
    nishiProviders: { all: () => [accountProvider('fixture', { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' })] },
    credentials: {
      describeRecord: async () => {
        throw new Error(secret)
      },
    },
  } as any)

  const flow = await controller.describeProviderPublic('fixture')

  assert.equal(flow?.providerId, 'fixture')
  assert.equal(flow?.configured, false)
  assert.equal(flow?.credentialKind, undefined)
  assert.equal(flow?.status, 'ERROR')
  assert.equal(flow?.lastError, 'Authorization state is unavailable.')
  assert.ok(!JSON.stringify(flow).includes(secret))
})

test('describeProviderPublic returns undefined for an id no live provider owns', async () => {
  const controller = new AuthorizationHostController({
    nishiProviders: { all: () => [] },
  } as any)

  assert.equal(await controller.describeProviderPublic('nobody'), undefined)
})

test('rpc rejects an unknown providerId with a generic bad request, not an internal error', async () => {
  const controller = new AuthorizationHostController({
    nishiProviders: { all: () => [accountProvider('fixture', { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' })] },
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)
  const handler = createAuthorizationRpcHandler(controller)

  const result = await handler(AUTH_GET_STATUS_ENDPOINT, { providerId: 'not-registered' }, signal)

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'bad-request')
  assert.equal(result.error.message, 'Invalid authorization request.')
})

test('rpc rejects a malformed providerId shape with a generic bad request', async () => {
  const controller = new AuthorizationHostController({ nishiProviders: { all: () => [] } } as any)
  const handler = createAuthorizationRpcHandler(controller)

  for (const payload of [{ providerId: 123 }, { providerId: ' padded ' }, { providerId: 'x', extra: 1 }, {}]) {
    const result = await handler(AUTH_GET_STATUS_ENDPOINT, payload, signal)
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.equal(result.error.code, 'bad-request')
  }
})

test('authorization rpc converts host failures to generic errors', async () => {
  const secret = 'local-path-or-token-secret'
  const controller = new AuthorizationHostController({ nishiProviders: { all: () => [] } } as any)
  ;(controller as any).describeProviderPublic = async () => {
    throw new Error(secret)
  }
  const handler = createAuthorizationRpcHandler(controller)

  const result = await handler(
    AUTH_GET_STATUS_ENDPOINT,
    { providerId: 'fixture' },
    signal,
  )

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'internal')
  assert.equal(result.error.message, 'Authorization operation failed.')
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('the removed mutating endpoints all answer a generic bad request', async () => {
  const controller = new AuthorizationHostController({ nishiProviders: { all: () => [] } } as any)
  const handler = createAuthorizationRpcHandler(controller)

  for (const endpoint of ['begin-login', 'submit-prompt', 'cancel-login', 'logout']) {
    const result = await handler(endpoint, { providerId: 'fixture' }, signal)
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.equal(result.error.code, 'bad-request')
    assert.equal(result.error.message, 'Invalid authorization request.')
  }
})

test('list-flows and refresh reject unexpected request fields', async () => {
  const controller = new AuthorizationHostController({ nishiProviders: { all: () => [] } } as any)
  const handler = createAuthorizationRpcHandler(controller)

  const badFlows = await handler(AUTH_GET_FLOWS_ENDPOINT, { unexpected: true }, signal)
  assert.equal(badFlows.ok, false)

  const badRefresh = await handler(AUTH_REFRESH_ENDPOINT, { unexpected: true }, signal)
  assert.equal(badRefresh.ok, false)
})

test('refresh with no providerId returns the full roster', async () => {
  const controller = new AuthorizationHostController({
    nishiProviders: { all: () => [accountProvider('fixture', { credentialScope: 'llm-pi-ai', credentialId: 'fixture', label: 'Fixture' })] },
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)
  const handler = createAuthorizationRpcHandler(controller)

  const result = await handler(AUTH_REFRESH_ENDPOINT, {}, signal)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(Array.isArray(result.value))
})
