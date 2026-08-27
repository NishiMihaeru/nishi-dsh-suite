/**
 * The provider registry: the one seam through which the core learns that a
 * provider exists.
 *
 * Providers are plugins for this plugin, and cordis is the plugin system —
 * a provider declares `inject: ['nishiProviders', ...]`, so cordis defers its
 * `apply` until this service exists and unwinds its registration when the
 * provider plugin is disposed. The core never imports a provider package and
 * never names one.
 *
 * @module nishi-dsh-core/registry/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { RegisteredProvider } from './descriptor.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nishiProviders: NishiProvidersService
  }
}

export class NishiProvidersService extends Service {
  readonly #byId = new Map<string, RegisteredProvider>()
  readonly #byRoute = new Map<string, RegisteredProvider>()
  readonly #listeners = new Set<() => void>()

  constructor(ctx: Context) {
    super(ctx, 'nishiProviders')
    // cordis serves a service to consumers through a Proxy, and a proxied
    // `this` cannot read the class's private fields — the same reason
    // `UsageLimitsHostService` binds its own methods here.
    this.record = this.record.bind(this)
    this.byId = this.byId.bind(this)
    this.byRoute = this.byRoute.bind(this)
    this.all = this.all.bind(this)
    this.onChange = this.onChange.bind(this)
  }

  /**
   * Record one provider. Rejects a duplicate id or a duplicate route naming
   * both providers, because a silent second registration would mean one
   * route quietly answering from the wrong vendor.
   */
  record(entry: RegisteredProvider): () => void {
    const id = entry.id.trim()
    if (id.length === 0) throw new Error('nishiProviders: a provider id must be non-empty')
    const existing = this.#byId.get(id)
    if (existing !== undefined) {
      throw new Error(`nishiProviders: provider "${id}" is already registered`)
    }
    for (const route of entry.routes) {
      const owner = this.#byRoute.get(route)
      if (owner !== undefined) {
        throw new Error(
          `nishiProviders: route "${route}" is already served by provider "${owner.id}"; "${id}" cannot claim it`,
        )
      }
    }

    this.#byId.set(id, entry)
    for (const route of entry.routes) this.#byRoute.set(route, entry)
    this.#announce()

    return () => {
      if (this.#byId.get(id) !== entry) return
      this.#byId.delete(id)
      for (const route of entry.routes) {
        if (this.#byRoute.get(route) === entry) this.#byRoute.delete(route)
      }
      this.#announce()
    }
  }

  byId(id: string): RegisteredProvider | undefined {
    return typeof id === 'string' ? this.#byId.get(id.trim()) : undefined
  }

  /** Resolve the provider serving one DSH model route (e.g. `codex-app-server`). */
  byRoute(route: string): RegisteredProvider | undefined {
    return typeof route === 'string' ? this.#byRoute.get(route.trim()) : undefined
  }

  all(): readonly RegisteredProvider[] {
    return [...this.#byId.values()]
  }

  /**
   * Observe registration changes. The usage surface derives its roster from
   * registrations rather than a fixed list, so a provider mounted after the
   * browser has rendered must be able to appear.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #announce(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}
