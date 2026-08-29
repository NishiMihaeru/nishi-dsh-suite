import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { NishiProvidersService } from '../src/registry/service.ts'
import { registerProvider } from '../src/runtime/registration.ts'
import { AuthorizationHostController } from '../src/host/authorization-rpc.ts'
import type { ProviderDescriptor } from '../src/registry/descriptor.ts'
import type { SharedProviderDefaults } from '../src/runtime/registration.ts'

/**
 * End-to-end coverage for the Model Accounts roster: real registration
 * through `registerProvider`, a real `NishiProvidersService`, and the host
 * controller reading `descriptor.account` off whatever the registry holds —
 * no fixed provider list anywhere in this path.
 */
async function fixture() {
  const ctx = new Context()
  await ctx.plugin(NishiProvidersService)
  return ctx
}

interface FixtureConfig extends SharedProviderDefaults {}

const CONFIG: FixtureConfig = {
  env: {},
  modelCacheMs: 0,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 10_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
}

function accountDescriptor(id: string, label: string): ProviderDescriptor<FixtureConfig> {
  return {
    id,
    presentation: { id, displayName: label, brandColor: '#123456' },
    executable: { id, defaultName: id, envOverride: `DSH_${id.toUpperCase()}_EXECUTABLE` },
    account: { credentialScope: 'llm-pi-ai', credentialId: id, label },
  }
}

function accountlessDescriptor(id: string): ProviderDescriptor<FixtureConfig> {
  return {
    id,
    presentation: { id, displayName: id, brandColor: '#654321' },
    executable: { id, defaultName: id, envOverride: `DSH_${id.toUpperCase()}_EXECUTABLE` },
  }
}

test('a provider that declares account gets a Model Accounts row', async () => {
  const ctx = await fixture()
  await registerProvider(ctx, accountDescriptor('fixture-a', 'Fixture A'), CONFIG)

  const controller = new AuthorizationHostController({
    nishiProviders: ctx.nishiProviders,
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)

  const flows = await controller.listFlowsPublic()
  assert.deepEqual(flows.map((f) => f.providerId), ['fixture-a'])
  assert.equal(flows[0]?.label, 'Fixture A')
})

test('a provider that declares no account gets no Model Accounts row', async () => {
  const ctx = await fixture()
  await registerProvider(ctx, accountlessDescriptor('fixture-b'), CONFIG)

  const controller = new AuthorizationHostController({
    nishiProviders: ctx.nishiProviders,
    credentials: { describeRecord: async () => ({ configured: true, kind: 'grant' }) },
  } as any)

  assert.deepEqual(await controller.listFlowsPublic(), [])
  assert.equal(await controller.describeProviderPublic('fixture-b'), undefined)
})

test('a mixed roster reports only the providers that declared account, keyed by canonical Nishi id', async () => {
  const ctx = await fixture()
  await registerProvider(ctx, accountDescriptor('fixture-a', 'Fixture A'), CONFIG)
  await registerProvider(ctx, accountlessDescriptor('fixture-b'), CONFIG)
  await registerProvider(ctx, accountDescriptor('fixture-c', 'Fixture C'), CONFIG)

  const controller = new AuthorizationHostController({
    nishiProviders: ctx.nishiProviders,
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)

  const flows = await controller.listFlowsPublic()
  assert.deepEqual(flows.map((f) => f.providerId).sort(), ['fixture-a', 'fixture-c'])
})

test('no record for the credential yields NOT_CONFIGURED', async () => {
  const ctx = await fixture()
  await registerProvider(ctx, accountDescriptor('fixture-a', 'Fixture A'), CONFIG)

  const controller = new AuthorizationHostController({
    nishiProviders: ctx.nishiProviders,
    credentials: { describeRecord: async () => ({ configured: false }) },
  } as any)

  const flow = await controller.describeProviderPublic('fixture-a')
  assert.equal(flow?.status, 'NOT_CONFIGURED')
})

test('a legitimate legacy grant yields CONNECTED', async () => {
  const ctx = await fixture()
  await registerProvider(ctx, accountDescriptor('fixture-a', 'Fixture A'), CONFIG)

  const controller = new AuthorizationHostController({
    nishiProviders: ctx.nishiProviders,
    credentials: { describeRecord: async () => ({ configured: true, kind: 'grant' }) },
  } as any)

  const flow = await controller.describeProviderPublic('fixture-a')
  assert.equal(flow?.status, 'CONNECTED')
  assert.equal(flow?.credentialKind, 'grant')
})

test('a credential-store read failure yields a sanitized ERROR, not NOT_CONFIGURED', async () => {
  const ctx = await fixture()
  await registerProvider(ctx, accountDescriptor('fixture-a', 'Fixture A'), CONFIG)

  const controller = new AuthorizationHostController({
    nishiProviders: ctx.nishiProviders,
    credentials: {
      describeRecord: async () => {
        throw new Error('backend-detail-that-must-not-leak')
      },
    },
  } as any)

  const flow = await controller.describeProviderPublic('fixture-a')
  assert.equal(flow?.status, 'ERROR')
  assert.notEqual(flow?.status, 'NOT_CONFIGURED')
  assert.ok(!JSON.stringify(flow).includes('backend-detail-that-must-not-leak'))
})
