import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type UsageSidebarSettings,
  type OrderedRosterItem,
  resolveOrderedRoster,
  resolveSidebarProviders,
  updateProviderVisibility,
  moveProviderInOrder,
} from '../src/client/view-model.ts'
import {
  UsageLimitsClientController,
  type UsageSidebarSettingsStorage,
  LocalStorageUsageSidebarSettingsStorage,
} from '../src/client/controller.ts'
import type { ProviderRosterEntry, UsageLimitsBrowserRpc } from '../src/client/rpc-client.ts'
import type { PublicProviderUsage } from '../src/usage/index.ts'

function createEntry(id: string): ProviderRosterEntry {
  return {
    providerId: id,
    presentation: { id, displayName: id.toUpperCase(), brandColor: '#222222' },
  }
}

class MemorySidebarSettingsStorage implements UsageSidebarSettingsStorage {
  private data: UsageSidebarSettings | undefined
  constructor(initial?: UsageSidebarSettings) {
    this.data = initial
  }
  load(): UsageSidebarSettings | undefined {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : undefined
  }
  save(settings: UsageSidebarSettings | undefined): void {
    this.data = settings ? JSON.parse(JSON.stringify(settings)) : undefined
  }
}

function createRpc(roster: ProviderRosterEntry[]): UsageLimitsBrowserRpc {
  return {
    async getRoster() { return roster },
    async getProviders() { return [] },
    async getProvider() { return null },
    async refreshProvider(providerId: string): Promise<PublicProviderUsage> {
      return {
        providerId,
        displayName: providerId.toUpperCase(),
        status: 'AVAILABLE',
        observedAtMs: Date.now(),
        freshness: 'FRESH',
        windows: [],
      }
    },
  }
}

// -----------------------------------------------------------------------------
// Default Behavior Tests
// -----------------------------------------------------------------------------

test('default behavior: undefined or null settings preserves exact roster order and visibility', () => {
  const roster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]

  const orderedUndefined = resolveOrderedRoster(roster, undefined)
  assert.deepEqual(
    orderedUndefined.map((item) => ({ id: item.entry.providerId, visible: item.visible })),
    [
      { id: 'codex', visible: true },
      { id: 'antigravity', visible: true },
      { id: 'claude', visible: true },
    ],
  )
  assert.deepEqual(
    resolveSidebarProviders(roster, undefined).map((item) => item.providerId),
    ['codex', 'antigravity', 'claude'],
  )

  const orderedNull = resolveOrderedRoster(roster, null)
  assert.deepEqual(
    resolveSidebarProviders(roster, null).map((item) => item.providerId),
    ['codex', 'antigravity', 'claude'],
  )

  const orderedEmpty = resolveOrderedRoster(roster, {})
  assert.deepEqual(
    resolveSidebarProviders(roster, {}).map((item) => item.providerId),
    ['codex', 'antigravity', 'claude'],
  )
})

test('default behavior: empty roster returns empty list without errors', () => {
  const roster: ProviderRosterEntry[] = []
  assert.deepEqual(resolveOrderedRoster(roster, undefined), [])
  assert.deepEqual(resolveSidebarProviders(roster, undefined), [])
  assert.deepEqual(resolveSidebarProviders(roster, { order: ['codex'], hidden: ['codex'] }), [])
})

// -----------------------------------------------------------------------------
// Provider Selection / Visibility Tests
// -----------------------------------------------------------------------------

test('selection: hiding a provider removes it from sidebar while keeping order of remaining providers', () => {
  const roster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]
  const settings: UsageSidebarSettings = { hidden: ['antigravity'] }

  const ordered = resolveOrderedRoster(roster, settings)
  assert.deepEqual(
    ordered.map((item) => ({ id: item.entry.providerId, visible: item.visible })),
    [
      { id: 'codex', visible: true },
      { id: 'antigravity', visible: false },
      { id: 'claude', visible: true },
    ],
  )

  const visible = resolveSidebarProviders(roster, settings)
  assert.deepEqual(visible.map((item) => item.providerId), ['codex', 'claude'])
})

test('selection: hiding all providers returns empty sidebar while keeping all in settings roster', () => {
  const roster = [createEntry('codex'), createEntry('antigravity')]
  const settings: UsageSidebarSettings = { hidden: ['codex', 'antigravity'] }

  assert.deepEqual(resolveSidebarProviders(roster, settings), [])
  const ordered = resolveOrderedRoster(roster, settings)
  assert.equal(ordered.length, 2)
  assert.equal(ordered.every((item) => !item.visible), true)
})

test('selection: updateProviderVisibility toggles provider visibility correctly', () => {
  let settings: UsageSidebarSettings | undefined

  settings = updateProviderVisibility(settings, 'codex', false)
  assert.deepEqual(settings, { hidden: ['codex'] })

  settings = updateProviderVisibility(settings, 'antigravity', false)
  assert.deepEqual(settings.hidden?.sort(), ['antigravity', 'codex'])

  settings = updateProviderVisibility(settings, 'codex', true)
  assert.deepEqual(settings, { hidden: ['antigravity'] })

  settings = updateProviderVisibility(settings, 'antigravity', true)
  assert.equal(settings.hidden, undefined)
})

// -----------------------------------------------------------------------------
// Provider Ordering Tests
// -----------------------------------------------------------------------------

test('ordering: explicit order rearranges providers in sidebar and settings list', () => {
  const roster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]
  const settings: UsageSidebarSettings = { order: ['claude', 'codex', 'antigravity'] }

  assert.deepEqual(
    resolveSidebarProviders(roster, settings).map((item) => item.providerId),
    ['claude', 'codex', 'antigravity'],
  )
  assert.deepEqual(
    resolveOrderedRoster(roster, settings).map((item) => item.entry.providerId),
    ['claude', 'codex', 'antigravity'],
  )
})

test('ordering: combined custom order and hidden selection', () => {
  const roster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]
  const settings: UsageSidebarSettings = {
    order: ['claude', 'antigravity', 'codex'],
    hidden: ['antigravity'],
  }

  assert.deepEqual(
    resolveSidebarProviders(roster, settings).map((item) => item.providerId),
    ['claude', 'codex'],
  )
  assert.deepEqual(
    resolveOrderedRoster(roster, settings).map((item) => ({
      id: item.entry.providerId,
      visible: item.visible,
    })),
    [
      { id: 'claude', visible: true },
      { id: 'antigravity', visible: false },
      { id: 'codex', visible: true },
    ],
  )
})

test('ordering: moveProviderInOrder moves providers up and down safely', () => {
  const roster = [createEntry('a'), createEntry('b'), createEntry('c')]
  let settings: UsageSidebarSettings | undefined

  // Move middle item up
  settings = moveProviderInOrder(roster, settings, 'b', 'up')
  assert.deepEqual(settings.order, ['b', 'a', 'c'])

  // Move top item up (no-op)
  const afterNoOpUp = moveProviderInOrder(roster, settings, 'b', 'up')
  assert.deepEqual(afterNoOpUp.order, ['b', 'a', 'c'])

  // Move middle item down
  settings = moveProviderInOrder(roster, settings, 'a', 'down')
  assert.deepEqual(settings.order, ['b', 'c', 'a'])

  // Move bottom item down (no-op)
  const afterNoOpDown = moveProviderInOrder(roster, settings, 'a', 'down')
  assert.deepEqual(afterNoOpDown.order, ['b', 'c', 'a'])

  // Move non-existent provider (safe no-op)
  const afterNonExistent = moveProviderInOrder(roster, settings, 'unknown', 'up')
  assert.deepEqual(afterNonExistent.order, ['b', 'c', 'a'])
})

// -----------------------------------------------------------------------------
// Unknown and Disappearing Providers Tests
// -----------------------------------------------------------------------------

test('unknown / disappearing providers: omitted from sidebar and settings list, reappears seamlessly', () => {
  const fullRoster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]
  const settings: UsageSidebarSettings = {
    order: ['claude', 'antigravity', 'codex', 'ghost-provider'],
    hidden: ['antigravity', 'ghost-hidden'],
  }

  // With full roster (ghost-provider is ignored)
  assert.deepEqual(
    resolveSidebarProviders(fullRoster, settings).map((item) => item.providerId),
    ['claude', 'codex'],
  )
  assert.deepEqual(
    resolveOrderedRoster(fullRoster, settings).map((item) => item.entry.providerId),
    ['claude', 'antigravity', 'codex'],
  )

  // When 'claude' is unmounted/unregistered
  const reducedRoster = [createEntry('codex'), createEntry('antigravity')]
  assert.deepEqual(
    resolveSidebarProviders(reducedRoster, settings).map((item) => item.providerId),
    ['codex'],
  )
  assert.deepEqual(
    resolveOrderedRoster(reducedRoster, settings).map((item) => item.entry.providerId),
    ['antigravity', 'codex'],
  )

  // When 'claude' is re-mounted, its top position in order is preserved
  assert.deepEqual(
    resolveSidebarProviders(fullRoster, settings).map((item) => item.providerId),
    ['claude', 'codex'],
  )
})

// -----------------------------------------------------------------------------
// New / Dynamic Providers Tests
// -----------------------------------------------------------------------------

test('new / dynamic providers: newly registered providers appear after ordered ones and are visible by default', () => {
  const initialRoster = [createEntry('codex'), createEntry('antigravity')]
  const settings: UsageSidebarSettings = {
    order: ['antigravity', 'codex'],
    hidden: ['codex'],
  }

  assert.deepEqual(
    resolveSidebarProviders(initialRoster, settings).map((item) => item.providerId),
    ['antigravity'],
  )

  // A new provider 'gemini' is registered dynamically
  const updatedRoster = [...initialRoster, createEntry('gemini')]

  const ordered = resolveOrderedRoster(updatedRoster, settings)
  assert.deepEqual(
    ordered.map((item) => ({ id: item.entry.providerId, visible: item.visible })),
    [
      { id: 'antigravity', visible: true },
      { id: 'codex', visible: false },
      { id: 'gemini', visible: true }, // new provider placed after ordered ones and visible by default
    ],
  )

  const visible = resolveSidebarProviders(updatedRoster, settings)
  assert.deepEqual(visible.map((item) => item.providerId), ['antigravity', 'gemini'])

  // Reordering the new provider moves it into the custom order
  const nextSettings = moveProviderInOrder(updatedRoster, settings, 'gemini', 'up')
  assert.deepEqual(nextSettings.order, ['antigravity', 'gemini', 'codex'])
})

// -----------------------------------------------------------------------------
// Controller & Storage Integration Tests
// -----------------------------------------------------------------------------

test('controller integration: loads initial settings from storage and updates on mutations', async () => {
  const storage = new MemorySidebarSettingsStorage({
    order: ['antigravity', 'codex'],
    hidden: ['codex'],
  })
  const roster = [createEntry('codex'), createEntry('antigravity')]
  const controller = new UsageLimitsClientController(createRpc(roster), storage)

  await controller.loadRoster()

  assert.deepEqual(controller.getSnapshot().sidebarSettings, {
    order: ['antigravity', 'codex'],
    hidden: ['codex'],
  })

  let notificationCount = 0
  controller.subscribe(() => { notificationCount++ })

  // Toggle visibility
  controller.setProviderVisible('codex', true)
  assert.equal(notificationCount, 1)
  assert.deepEqual(controller.getSnapshot().sidebarSettings?.hidden, undefined)
  assert.deepEqual(storage.load()?.hidden, undefined)

  // Move order
  controller.moveProviderOrder('codex', 'up')
  assert.equal(notificationCount, 2)
  assert.deepEqual(controller.getSnapshot().sidebarSettings?.order, ['codex', 'antigravity'])
  assert.deepEqual(storage.load()?.order, ['codex', 'antigravity'])

  // Reset settings
  controller.resetSidebarSettings()
  assert.equal(notificationCount, 3)
  assert.equal(controller.getSnapshot().sidebarSettings, undefined)
  assert.equal(storage.load(), undefined)
})

test('controller integration: loadRoster preserves user sidebar settings across topology changes', async () => {
  const storage = new MemorySidebarSettingsStorage({ order: ['antigravity', 'codex'] })
  let roster = [createEntry('codex'), createEntry('antigravity')]
  const controller = new UsageLimitsClientController(createRpc(roster), storage)

  await controller.loadRoster()
  assert.deepEqual(controller.getSnapshot().sidebarSettings?.order, ['antigravity', 'codex'])

  // New roster arrives
  roster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]
  await controller.loadRoster()

  assert.deepEqual(
    controller.getSnapshot().sidebarSettings?.order,
    ['antigravity', 'codex'],
    'sidebar settings must not be overwritten by loadRoster',
  )
})

test('storage: LocalStorageUsageSidebarSettingsStorage safely handles invalid or missing data', () => {
  const storage = new LocalStorageUsageSidebarSettingsStorage('test-nonexistent-key')
  assert.equal(storage.load(), undefined)
})

test('storage: LocalStorageUsageSidebarSettingsStorage saves, loads and removes settings with mocked localStorage', () => {
  const map = new Map<string, string>()
  const mockLocalStorage = {
    getItem(key: string) { return map.get(key) ?? null },
    setItem(key: string, value: string) { map.set(key, value) },
    removeItem(key: string) { map.delete(key) },
    clear() { map.clear() },
    key() { return null },
    length: 0,
  }

  const origLocalStorage = (globalThis as any).localStorage
  try {
    ;(globalThis as any).localStorage = mockLocalStorage
    const storage = new LocalStorageUsageSidebarSettingsStorage('test:key')

    // Initial load: empty
    assert.equal(storage.load(), undefined)

    // Save and load valid settings
    storage.save({ order: ['a', 'b'], hidden: ['b'] })
    assert.deepEqual(storage.load(), { order: ['a', 'b'], hidden: ['b'] })

    // Save undefined or empty settings removes key
    storage.save(undefined)
    assert.equal(mockLocalStorage.getItem('test:key'), null)
    assert.equal(storage.load(), undefined)

    storage.save({ order: [], hidden: [] })
    assert.equal(mockLocalStorage.getItem('test:key'), null)

    // Malformed JSON
    mockLocalStorage.setItem('test:key', 'not-valid-json{')
    assert.equal(storage.load(), undefined)

    // Non-object JSON
    mockLocalStorage.setItem('test:key', JSON.stringify('string-only'))
    assert.equal(storage.load(), undefined)

    mockLocalStorage.setItem('test:key', JSON.stringify(12345))
    assert.equal(storage.load(), undefined)

    // Array filtering non-strings
    mockLocalStorage.setItem('test:key', JSON.stringify({ order: ['valid', 123, null, {}], hidden: ['h1', false] }))
    assert.deepEqual(storage.load(), { order: ['valid'], hidden: ['h1'] })

    // When localStorage throws
    const throwingStorage = {
      getItem() { throw new Error('security denied') },
      setItem() { throw new Error('quota exceeded') },
      removeItem() { throw new Error('access denied') },
    }
    ;(globalThis as any).localStorage = throwingStorage
    const resilientStorage = new LocalStorageUsageSidebarSettingsStorage('test:key')
    assert.equal(resilientStorage.load(), undefined)
    assert.doesNotThrow(() => resilientStorage.save({ order: ['a'] }))
  } finally {
    ;(globalThis as any).localStorage = origLocalStorage
  }
})

test('controller integration: dispose prevents notifications on subsequent settings mutations', async () => {
  const storage = new MemorySidebarSettingsStorage()
  const roster = [createEntry('codex'), createEntry('antigravity')]
  const controller = new UsageLimitsClientController(createRpc(roster), storage)

  let notifications = 0
  controller.subscribe(() => { notifications++ })

  controller.setProviderVisible('codex', false)
  assert.equal(notifications, 1)

  controller.dispose()

  controller.setProviderVisible('codex', true)
  controller.moveProviderOrder('codex', 'up')
  controller.resetSidebarSettings()

  assert.equal(notifications, 1, 'listeners must not be called after controller is disposed')
})


test('ordering: reordering while a provider is unregistered keeps that provider\'s remembered slot', () => {
  const settings: UsageSidebarSettings = { order: ['codex', 'antigravity', 'claude'] }
  // 'antigravity' is not registered in this session at all.
  const reducedRoster = [createEntry('codex'), createEntry('claude')]
  assert.deepEqual(
    resolveOrderedRoster(reducedRoster, settings).map((item) => item.entry.providerId),
    ['codex', 'claude'],
  )

  // The user moves 'claude' above 'codex' while 'antigravity' is away.
  const moved = moveProviderInOrder(reducedRoster, settings, 'claude', 'up')
  assert.deepEqual(
    resolveOrderedRoster(reducedRoster, moved).map((item) => item.entry.providerId),
    ['claude', 'codex'],
    'the visible move takes effect',
  )

  // When it comes back it must land where it was put, not at the end.
  const fullRoster = [createEntry('codex'), createEntry('antigravity'), createEntry('claude')]
  assert.deepEqual(
    resolveOrderedRoster(fullRoster, moved).map((item) => item.entry.providerId),
    ['claude', 'antigravity', 'codex'],
  )
})

test('ordering: a duplicated id in a saved order does not desynchronise the rewrite', () => {
  const settings: UsageSidebarSettings = { order: ['codex', 'codex', 'claude'] }
  const roster = [createEntry('codex'), createEntry('claude')]
  const moved = moveProviderInOrder(roster, settings, 'claude', 'up')
  assert.deepEqual(
    resolveOrderedRoster(roster, moved).map((item) => item.entry.providerId),
    ['claude', 'codex'],
  )
})

// -----------------------------------------------------------------------------
// Pool-Level Visibility and Ordering Tests (e.g. Antigravity Gemini vs Claude/GPT)
// -----------------------------------------------------------------------------

test('pool-level settings: pools can be hidden and reordered independently', () => {
  const pools = [
    {
      id: 'antigravity:pool:gemini',
      providerId: 'antigravity',
      displayName: 'Gemini',
      kind: 'POOL' as const,
    },
    {
      id: 'antigravity:pool:claude-gpt',
      providerId: 'antigravity',
      displayName: 'Claude / GPT',
      kind: 'POOL' as const,
    },
    {
      id: 'codex',
      providerId: 'codex',
      displayName: 'Codex',
      kind: 'PROVIDER' as const,
    },
  ]

  // Default ordering: natural roster order, all visible
  const defaultOrdered = resolveOrderedRoster(pools, undefined)
  assert.deepEqual(
    defaultOrdered.map((item) => ({ id: item.entry.id, visible: item.visible })),
    [
      { id: 'antigravity:pool:gemini', visible: true },
      { id: 'antigravity:pool:claude-gpt', visible: true },
      { id: 'codex', visible: true },
    ],
  )
  assert.deepEqual(
    resolveSidebarProviders(pools, undefined).map((item) => item.id),
    ['antigravity:pool:gemini', 'antigravity:pool:claude-gpt', 'codex'],
  )

  // 1. Hide only Gemini pool
  const hideGeminiSettings = updateProviderVisibility(undefined, 'antigravity:pool:gemini', false)
  assert.deepEqual(hideGeminiSettings, { hidden: ['antigravity:pool:gemini'] })
  assert.deepEqual(
    resolveSidebarProviders(pools, hideGeminiSettings).map((item) => item.id),
    ['antigravity:pool:claude-gpt', 'codex'],
    'only Claude / GPT pool and Codex are visible when Gemini pool is hidden',
  )

  // 2. Hide only Claude / GPT pool
  const hideClaudeSettings = updateProviderVisibility(undefined, 'antigravity:pool:claude-gpt', false)
  assert.deepEqual(
    resolveSidebarProviders(pools, hideClaudeSettings).map((item) => item.id),
    ['antigravity:pool:gemini', 'codex'],
    'only Gemini pool and Codex are visible when Claude / GPT pool is hidden',
  )

  // 3. Reorder pools: swap Gemini and Claude / GPT pools
  const reorderPools = moveProviderInOrder(pools, undefined, 'antigravity:pool:claude-gpt', 'up')
  assert.deepEqual(reorderPools.order, [
    'antigravity:pool:claude-gpt',
    'antigravity:pool:gemini',
    'codex',
  ])
  assert.deepEqual(
    resolveSidebarProviders(pools, reorderPools).map((item) => item.id),
    ['antigravity:pool:claude-gpt', 'antigravity:pool:gemini', 'codex'],
    'Claude / GPT pool now appears before Gemini pool',
  )

  // 4. Reorder pools across providers: e.g. Claude / GPT -> Codex -> Gemini
  const reorderAcross = moveProviderInOrder(pools, reorderPools, 'codex', 'up')
  assert.deepEqual(reorderAcross.order, [
    'antigravity:pool:claude-gpt',
    'codex',
    'antigravity:pool:gemini',
  ])
  assert.deepEqual(
    resolveSidebarProviders(pools, reorderAcross).map((item) => item.id),
    ['antigravity:pool:claude-gpt', 'codex', 'antigravity:pool:gemini'],
  )
})
