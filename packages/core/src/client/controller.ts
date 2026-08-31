import type { PublicProviderUsage } from '../usage/index.js'
import type { ProviderRosterEntry, UsageLimitsBrowserRpc } from './rpc-client.js'
import {
  type UsageSidebarSettings,
  updateProviderVisibility,
  moveProviderInOrder,
} from './view-model.js'
import {
  buildUsageGroupsForProvider,
  type UsageGroup,
} from './usage-group-model.js'

export type ProviderLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface ProviderEntryState {
  status: ProviderLoadStatus
  usage?: PublicProviderUsage
  errorMessage?: string
}
export interface UsageLimitsControllerSnapshot {
  phase: 'idle' | 'loading' | 'ready'
  /**
   * Which providers exist, in host registration order. Derived from the host
   * rather than shipped with the browser, so a provider mounted late appears
   * and an unmounted one leaves no placeholder.
   */
  roster: readonly ProviderRosterEntry[]
  providers: Record<string, ProviderEntryState>
  lastRefreshedAtMs?: number
  sidebarSettings?: UsageSidebarSettings
}

export interface UsageSidebarSettingsStorage {
  load(): UsageSidebarSettings | undefined
  save(settings: UsageSidebarSettings | undefined): void
}

export const USAGE_SIDEBAR_SETTINGS_STORAGE_KEY = 'dsh:usage-limits:sidebar-settings'

export class LocalStorageUsageSidebarSettingsStorage implements UsageSidebarSettingsStorage {
  constructor(private readonly key = USAGE_SIDEBAR_SETTINGS_STORAGE_KEY) {}

  load(): UsageSidebarSettings | undefined {
    if (typeof localStorage === 'undefined') return undefined
    try {
      const raw = localStorage.getItem(this.key)
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const order = Array.isArray((parsed as Record<string, unknown>).order)
        ? (parsed as { order: unknown[] }).order.filter((x): x is string => typeof x === 'string')
        : undefined
      const hidden = Array.isArray((parsed as Record<string, unknown>).hidden)
        ? (parsed as { hidden: unknown[] }).hidden.filter((x): x is string => typeof x === 'string')
        : undefined
      if (!order && !hidden) return undefined
      return {
        ...(order ? { order } : {}),
        ...(hidden ? { hidden } : {}),
      }
    } catch {
      return undefined
    }
  }

  save(settings: UsageSidebarSettings | undefined): void {
    if (typeof localStorage === 'undefined') return
    try {
      if (!settings || (!settings.order?.length && !settings.hidden?.length)) {
        localStorage.removeItem(this.key)
      } else {
        localStorage.setItem(this.key, JSON.stringify(settings))
      }
    } catch {
      // Ignore write errors (quota exceeded / security restrictions)
    }
  }
}

interface InFlightRefresh {
  readonly generation: number
  readonly promise: Promise<PublicProviderUsage>
}

interface Settler {
  readonly promise: Promise<PublicProviderUsage>
  resolve(value: PublicProviderUsage): void
  reject(reason: unknown): void
}

/**
 * `Promise.withResolvers` is ES2024 and this package compiles against the
 * ES2022 lib, so the one place that needs a promise before its producer exists
 * builds the pair by hand.
 */
function settler(): Settler {
  let resolve!: (value: PublicProviderUsage) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<PublicProviderUsage>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export class UsageLimitsClientController {
  private snapshot: UsageLimitsControllerSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly inFlightRefreshes = new Map<string, InFlightRefresh>()
  private initializePromise?: Promise<void>
  /** Every accepted roster response establishes a new topology generation. */
  private rosterGeneration = 0
  /** Prevent an older concurrent getRoster response from replacing a newer one. */
  private rosterRequestSerial = 0

  constructor(
    private readonly rpc: UsageLimitsBrowserRpc,
    private readonly storage: UsageSidebarSettingsStorage = new LocalStorageUsageSidebarSettingsStorage(),
  ) {
    const sidebarSettings = this.storage.load()
    this.snapshot = {
      phase: 'idle',
      roster: [],
      providers: {},
      ...(sidebarSettings ? { sidebarSettings } : {}),
    }
  }

  getSnapshot(): UsageLimitsControllerSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void { for (const listener of this.listeners) listener() }

  getSidebarSettings(): UsageSidebarSettings | undefined {
    return this.snapshot.sidebarSettings
  }

  setSidebarSettings(settings: UsageSidebarSettings | undefined): void {
    this.snapshot = {
      ...this.snapshot,
      sidebarSettings: settings,
    }
    this.storage.save(settings)
    this.notify()
  }

  setProviderVisible(targetId: string, visible: boolean): void {
    const nextSettings = updateProviderVisibility(this.snapshot.sidebarSettings, targetId, visible)
    this.setSidebarSettings(nextSettings)
  }

  moveProviderOrder(targetId: string, direction: 'up' | 'down'): void {
    const allGroups = this.getAllUsageGroups()
    const items = allGroups.length > 0 ? allGroups : this.snapshot.roster
    const nextSettings = moveProviderInOrder(items, this.snapshot.sidebarSettings, targetId, direction)
    this.setSidebarSettings(nextSettings)
  }

  getAllUsageGroups(): UsageGroup[] {
    return this.snapshot.roster.flatMap((item) => {
      const entry = this.snapshot.providers[item.providerId]
      return buildUsageGroupsForProvider({
        presentation: item.presentation,
        loadStatus: entry?.status ?? 'idle',
        usage: entry?.usage,
      })
    })
  }

  resetSidebarSettings(): void {
    this.setSidebarSettings(undefined)
  }

  /**
   * Tear down this controller when the browser plugin unloads. Subscribers
   * stop being notified immediately. Advancing `rosterGeneration` reuses the
   * existing fencing every refresh write already checks via `hasProvider()`,
   * so a refresh that was already in flight cannot publish into the snapshot
   * after dispose — no separate "disposed" flag is needed for that. Clearing
   * `inFlightRefreshes` only drops bookkeeping; it does not cancel the
   * underlying RPC calls, which is fine since their results can no longer
   * reach anything observable.
   */
  dispose(): void {
    this.rosterGeneration++
    this.listeners.clear()
    this.inFlightRefreshes.clear()
  }

  private hasProvider(providerId: string, generation = this.rosterGeneration): boolean {
    return generation === this.rosterGeneration
      && this.snapshot.roster.some((entry) => entry.providerId === providerId)
  }

  initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise
    this.snapshot = { ...this.snapshot, phase: 'loading' }
    this.notify()
    const promise = (async () => {
      await this.loadRoster()
      await this.loadCached()
      await this.ensureAllFresh()
      this.snapshot = { ...this.snapshot, phase: 'ready' }
      this.notify()
    })().finally(() => { this.initializePromise = undefined })
    this.initializePromise = promise
    return promise
  }

  /**
   * Learn the current roster and seed one loading row per provider.
   *
   * Only the newest concurrent roster request may publish. Every accepted
   * response advances `rosterGeneration`, even when the visible ids are the
   * same: a provider may have been unloaded and re-registered between two
   * polls while keeping its canonical id. Async work captured under an older
   * generation must therefore never mutate the new topology.
   *
   * A failed roster refresh preserves the last-known-good roster rather than
   * inventing a topology change the host did not confirm.
   */
  async loadRoster(): Promise<void> {
    const requestSerial = ++this.rosterRequestSerial
    let roster: readonly ProviderRosterEntry[]
    try {
      roster = await this.rpc.getRoster()
    } catch {
      if (requestSerial === this.rosterRequestSerial) this.notify()
      return
    }
    if (requestSerial !== this.rosterRequestSerial) return

    this.rosterGeneration++
    const providers: Record<string, ProviderEntryState> = {}
    for (const entry of roster) {
      const prior = this.snapshot.providers[entry.providerId]
      providers[entry.providerId] = { status: 'loading', ...(prior?.usage ? { usage: prior.usage } : {}) }
    }
    this.snapshot = { ...this.snapshot, roster, providers }
    this.notify()
  }

  async loadCached(): Promise<void> {
    const generation = this.rosterGeneration
    try {
      const cachedProviders = await this.rpc.getProviders()
      if (generation !== this.rosterGeneration) return

      const cachedById = new Map(cachedProviders.map((item) => [item.providerId, item] as const))
      const newProviders: Record<string, ProviderEntryState> = {}
      for (const entry of this.snapshot.roster) {
        const usage = cachedById.get(entry.providerId)
        // The host's cached list is authoritative. A missing provider means
        // its prior observation was invalidated or never collected, so a
        // browser-side FRESH copy must not survive and suppress ensureFresh().
        newProviders[entry.providerId] = usage === undefined
          ? { status: 'loading' }
          : { status: 'ready', usage }
      }
      this.snapshot = {
        phase: 'ready',
        roster: this.snapshot.roster,
        providers: newProviders,
        lastRefreshedAtMs: this.snapshot.lastRefreshedAtMs,
      }
    } catch {
      if (generation !== this.rosterGeneration) return
      this.snapshot = { ...this.snapshot, phase: 'ready' }
    }
    this.notify()
  }

  async ensureFresh(providerId: string): Promise<void> {
    const existing = this.snapshot.providers[providerId]?.usage
    // UNSUPPORTED is a capability declaration, not stale vendor data. There
    // is nothing to refresh until the provider is re-registered with a usage
    // capability, at which point the next roster refresh replaces this row.
    if (existing?.status === 'UNSUPPORTED') return
    if (existing?.freshness === 'FRESH') return
    await this.doRefresh(providerId, false)
  }
  async ensureAllFresh(): Promise<void> {
    for (const entry of this.snapshot.roster) await this.ensureFresh(entry.providerId)
  }
  async refreshProvider(providerId: string): Promise<void> { await this.doRefresh(providerId, true) }
  async refreshAll(): Promise<void> {
    await this.loadRoster()
    for (const entry of this.snapshot.roster) await this.refreshProvider(entry.providerId)
  }

  private async doRefresh(providerId: string, force: boolean): Promise<void> {
    const generation = this.rosterGeneration
    if (!this.hasProvider(providerId, generation)) return

    const active = this.inFlightRefreshes.get(providerId)
    if (active?.generation === generation) {
      await active.promise.catch(() => {})
      return
    }

    const prior = this.snapshot.providers[providerId]
    this.snapshot = {
      ...this.snapshot,
      providers: { ...this.snapshot.providers, [providerId]: { status: 'loading', usage: prior?.usage } },
    }
    this.notify()

    // The record must be joinable from the moment it is published, and it must
    // be published before the async body below can run — not after it. `rpc` is
    // caller-supplied, and an implementation may throw synchronously rather
    // than return a rejected promise. An async IIFE runs synchronously up to
    // its first `await`, so such a throw reaches `catch`/`finally` immediately,
    // before control returns here. Publishing the record afterwards would leave
    // `finally` comparing against a variable it cannot see yet, so the dead
    // entry would survive and every later `doRefresh` for this provider and
    // generation would join its rejected promise instead of calling `rpc`
    // again. Settling through explicit resolvers keeps `record.promise` a real
    // promise for the whole window, including the re-entrant case where the
    // synchronous `catch` notifies a listener that refreshes again.
    const settled = settler()
    const record: InFlightRefresh = { generation, promise: settled.promise }
    this.inFlightRefreshes.set(providerId, record)
    void settled.promise.catch(() => {})

    void (async () => {
      try {
        const usage = await this.rpc.refreshProvider(providerId, { force })
        if (this.hasProvider(providerId, generation)) {
          this.snapshot = {
            ...this.snapshot,
            providers: { ...this.snapshot.providers, [providerId]: { status: 'ready', usage } },
            lastRefreshedAtMs: Date.now(),
          }
          this.notify()
        }
        return usage
      } catch {
        if (this.hasProvider(providerId, generation)) {
          this.snapshot = {
            ...this.snapshot,
            providers: {
              ...this.snapshot.providers,
              [providerId]: { status: 'error', usage: prior?.usage, errorMessage: 'Usage data is unavailable.' },
            },
          }
          this.notify()
        }
        throw new Error('Usage data is unavailable.')
      } finally {
        if (this.inFlightRefreshes.get(providerId) === record) {
          this.inFlightRefreshes.delete(providerId)
        }
      }
    })().then(settled.resolve, settled.reject)
    await record.promise.catch(() => {})
  }
}
