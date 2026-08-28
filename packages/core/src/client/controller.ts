import type { PublicProviderUsage } from '../usage/index.js'
import type { ProviderRosterEntry, UsageLimitsBrowserRpc } from './rpc-client.js'

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
}

interface InFlightRefresh {
  generation: number
  promise: Promise<PublicProviderUsage>
}

export class UsageLimitsClientController {
  private snapshot: UsageLimitsControllerSnapshot = { phase: 'idle', roster: [], providers: {} }
  private readonly listeners = new Set<() => void>()
  private readonly inFlightRefreshes = new Map<string, InFlightRefresh>()
  private initializePromise?: Promise<void>
  /** Every accepted roster response establishes a new topology generation. */
  private rosterGeneration = 0
  /** Prevent an older concurrent getRoster response from replacing a newer one. */
  private rosterRequestSerial = 0

  constructor(private readonly rpc: UsageLimitsBrowserRpc) {}

  getSnapshot(): UsageLimitsControllerSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void { for (const listener of this.listeners) listener() }

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

    let record!: InFlightRefresh
    const promise = (async () => {
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
    })()
    record = { generation, promise }
    this.inFlightRefreshes.set(providerId, record)
    await promise.catch(() => {})
  }
}
