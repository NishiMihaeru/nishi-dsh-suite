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

export class UsageLimitsClientController {
  private snapshot: UsageLimitsControllerSnapshot = { phase: 'idle', roster: [], providers: {} }
  private readonly listeners = new Set<() => void>()
  private readonly inFlightRefreshes = new Map<string, Promise<PublicProviderUsage>>()
  private initializePromise?: Promise<void>

  constructor(private readonly rpc: UsageLimitsBrowserRpc) {}

  getSnapshot(): UsageLimitsControllerSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void { for (const listener of this.listeners) listener() }

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
   * Learn the roster, then seed one loading row per provider. A failed roster
   * call leaves the surface empty rather than inventing providers.
   */
  async loadRoster(): Promise<void> {
    let roster: readonly ProviderRosterEntry[]
    try {
      roster = await this.rpc.getRoster()
    } catch {
      this.notify()
      return
    }
    const providers: Record<string, ProviderEntryState> = {}
    for (const entry of roster) {
      const prior = this.snapshot.providers[entry.providerId]
      providers[entry.providerId] = { status: 'loading', ...(prior?.usage ? { usage: prior.usage } : {}) }
    }
    this.snapshot = { ...this.snapshot, roster, providers }
    this.notify()
  }

  async loadCached(): Promise<void> {
    try {
      const providers = await this.rpc.getProviders()
      const newProviders = { ...this.snapshot.providers }
      for (const item of providers) newProviders[item.providerId] = { status: 'ready', usage: item }
      this.snapshot = {
        phase: 'ready',
        roster: this.snapshot.roster,
        providers: newProviders,
        lastRefreshedAtMs: this.snapshot.lastRefreshedAtMs,
      }
    } catch {
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
    const active = this.inFlightRefreshes.get(providerId)
    if (active) { await active.catch(() => {}); return }
    const prior = this.snapshot.providers[providerId]
    this.snapshot = {
      ...this.snapshot,
      providers: { ...this.snapshot.providers, [providerId]: { status: 'loading', usage: prior?.usage } },
    }
    this.notify()
    const promise = (async () => {
      try {
        const usage = await this.rpc.refreshProvider(providerId, { force })
        this.snapshot = {
          ...this.snapshot,
          providers: { ...this.snapshot.providers, [providerId]: { status: 'ready', usage } },
          lastRefreshedAtMs: Date.now(),
        }
        this.notify()
        return usage
      } catch {
        this.snapshot = {
          ...this.snapshot,
          providers: {
            ...this.snapshot.providers,
            [providerId]: { status: 'error', usage: prior?.usage, errorMessage: 'Usage data is unavailable.' },
          },
        }
        this.notify()
        throw new Error('Usage data is unavailable.')
      } finally {
        this.inFlightRefreshes.delete(providerId)
      }
    })()
    this.inFlightRefreshes.set(providerId, promise)
    await promise.catch(() => {})
  }
}
