import type { PublicProviderUsage } from '../usage/index.js'
import { PRODUCT_PROVIDER_ROSTER } from './roster.js'
import type { UsageLimitsBrowserRpc } from './rpc-client.js'

export type ProviderLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface ProviderEntryState {
  status: ProviderLoadStatus
  usage?: PublicProviderUsage
  errorMessage?: string
}
export interface UsageLimitsControllerSnapshot {
  phase: 'idle' | 'loading' | 'ready'
  providers: Record<string, ProviderEntryState>
  lastRefreshedAtMs?: number
}

export class UsageLimitsClientController {
  private snapshot: UsageLimitsControllerSnapshot = { phase: 'idle', providers: {} }
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
    const providers: Record<string, ProviderEntryState> = { ...this.snapshot.providers }
    for (const item of PRODUCT_PROVIDER_ROSTER) {
      const prior = providers[item.id]
      providers[item.id] = { status: 'loading', ...(prior?.usage ? { usage: prior.usage } : {}) }
    }
    this.snapshot = { ...this.snapshot, phase: 'loading', providers }
    this.notify()
    const promise = (async () => {
      await this.loadCached()
      await this.ensureAllFresh()
      this.snapshot = { ...this.snapshot, phase: 'ready' }
      this.notify()
    })().finally(() => { this.initializePromise = undefined })
    this.initializePromise = promise
    return promise
  }

  async loadCached(): Promise<void> {
    try {
      const providers = await this.rpc.getProviders()
      const newProviders = { ...this.snapshot.providers }
      for (const item of providers) newProviders[item.providerId] = { status: 'ready', usage: item }
      this.snapshot = { phase: 'ready', providers: newProviders, lastRefreshedAtMs: this.snapshot.lastRefreshedAtMs }
    } catch {
      this.snapshot = { ...this.snapshot, phase: 'ready' }
    }
    this.notify()
  }

  async ensureFresh(providerId: string): Promise<void> {
    const existing = this.snapshot.providers[providerId]?.usage
    if (existing?.freshness === 'FRESH') return
    await this.doRefresh(providerId, false)
  }
  async ensureAllFresh(): Promise<void> {
    for (const item of PRODUCT_PROVIDER_ROSTER) await this.ensureFresh(item.id)
  }
  async refreshProvider(providerId: string): Promise<void> { await this.doRefresh(providerId, true) }
  async refreshAll(): Promise<void> {
    for (const item of PRODUCT_PROVIDER_ROSTER) await this.refreshProvider(item.id)
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
