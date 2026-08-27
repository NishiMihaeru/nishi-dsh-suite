import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageLimitsClientController } from '../src/client/controller.ts'
import type { ProviderRosterEntry } from '../src/client/rpc-client.ts'
import type { PublicProviderUsage } from '../src/usage/index.ts'

const roster: ProviderRosterEntry[] = [{
  providerId: 'fixture',
  presentation: {
    id: 'fixture',
    displayName: 'Fixture Provider',
    brandColor: '#123456',
  },
}]

const unsupported: PublicProviderUsage = {
  providerId: 'fixture',
  displayName: 'Fixture Provider',
  status: 'UNSUPPORTED',
  observedAtMs: 1_234,
  freshness: 'UNKNOWN',
  windows: [],
}

test('initialization keeps descriptor-level UNSUPPORTED ready without issuing a refresh call', async () => {
  let refreshCalls = 0
  const controller = new UsageLimitsClientController({
    async getRoster() { return roster },
    async getProviders() { return [unsupported] },
    async getProvider() { return unsupported },
    async refreshProvider() {
      refreshCalls += 1
      throw new Error('an unsupported capability must not be refreshed during initialization')
    },
  })

  await controller.initialize()

  const state = controller.getSnapshot().providers.fixture
  assert.equal(refreshCalls, 0)
  assert.equal(state?.status, 'ready')
  assert.deepEqual(state?.usage, unsupported)
})

test('manual refresh remains legal for an unsupported row and uses the common RPC path', async () => {
  let refreshCalls = 0
  const controller = new UsageLimitsClientController({
    async getRoster() { return roster },
    async getProviders() { return [unsupported] },
    async getProvider() { return unsupported },
    async refreshProvider() {
      refreshCalls += 1
      return unsupported
    },
  })

  await controller.initialize()
  await controller.refreshProvider('fixture')

  assert.equal(refreshCalls, 1)
  assert.equal(controller.getSnapshot().providers.fixture?.usage?.status, 'UNSUPPORTED')
  assert.equal(controller.getSnapshot().providers.fixture?.status, 'ready')
})
