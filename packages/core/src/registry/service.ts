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
import { canonicalProviderId, canonicalProviderRoute } from './identity.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nishiProviders: NishiProvidersService
  }
}

type RegistryChangeListener = () => void | PromiseLike<void>

export class NishiProvidersService extends Service {
  readonly #byId = new Map<string, RegisteredProvider>()
  readonly #byRoute = new Map<string, RegisteredProvider>()
  readonly #listeners = new Set<RegistryChangeListener>()
  readonly #invalidationListeners = new Set<(providerId: string) => void>()

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
    this.invalidate = this.invalidate.bind(this)
    this.onInvalidate = this.onInvalidate.bind(this)
  }

  /**
   * Record one provider. Identity is accepted only in canonical form: the
   * registry never silently trims or rewrites an id/route because doing so
   * would let the Map key disagree with the RegisteredProvider it returns.
   * Duplicate ids, duplicate routes between providers, and duplicate routes
   * inside one provider are all rejected before any state is changed.
   *
   * Change listeners are observers, not transaction participants. Once the
   * registry commit is complete, one broken observer must not turn a valid
   * registration into a thrown call whose disposer the caller never receives.
   */
  record(entry: RegisteredProvider): () => void {
    const id = canonicalProviderId(entry.id, 'nishiProviders: provider id')
    const existing = this.#byId.get(id)
    if (existing !== undefined) {
      throw new Error(`nishiProviders: provider "${id}" is already registered`)
    }

    const routes: string[] = []
    const seenRoutes = new Set<string>()
    for (let index = 0; index < entry.routes.length; index++) {
      const route = canonicalProviderRoute(entry.routes[index], `nishiProviders: routes[${index}]`)
      if (seenRoutes.has(route)) {
        throw new Error(`nishiProviders: provider "${id}" declares duplicate route "${route}"`)
      }
      seenRoutes.add(route)
      routes.push(route)

      const owner = this.#byRoute.get(route)
      if (owner !== undefined) {
        throw new Error(
          `nishiProviders: route "${route}" is already served by provider "${owner.id}"; "${id}" cannot claim it`,
        )
      }
    }

    this.#byId.set(id, entry)
    for (const route of routes) this.#byRoute.set(route, entry)
    this.#announce()

    return () => {
      if (this.#byId.get(id) !== entry) return
      this.#byId.delete(id)
      for (const route of routes) {
        if (this.#byRoute.get(route) === entry) this.#byRoute.delete(route)
      }
      this.#announce()
    }
  }

  byId(id: string): RegisteredProvider | undefined {
    return typeof id === 'string' ? this.#byId.get(id) : undefined
  }

  /** Resolve the provider serving one DSH model route. */
  byRoute(route: string): RegisteredProvider | undefined {
    return typeof route === 'string' ? this.#byRoute.get(route) : undefined
  }

  all(): readonly RegisteredProvider[] {
    return [...this.#byId.values()]
  }

  /**
   * Observe registration changes. The usage surface derives its roster from
   * registrations rather than a fixed list, so a provider mounted after the
   * browser has rendered must be able to appear.
   */
  onChange(listener: RegistryChangeListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * A provider reports that its cached usage is superseded. The registry is
   * only the bus: it does not know what a snapshot or a cache is, which is
   * what keeps the usage domain out of the registration path.
   */
  invalidate(providerId: string): void {
    for (const listener of [...this.#invalidationListeners]) listener(providerId)
  }

  onInvalidate(listener: (providerId: string) => void): () => void {
    this.#invalidationListeners.add(listener)
    return () => {
      this.#invalidationListeners.delete(listener)
    }
  }

  /** Notify every observer independently; registry changes are non-vetoing. */
  #announce(): void {
    for (const listener of [...this.#listeners]) {
      try {
        const returned = listener()
        if (returned != null && typeof returned.then === 'function') {
          // An async observer rejection is equally non-vetoing and must not
          // become an unhandled rejection after the registry commit.
          void Promise.resolve(returned).catch(() => {})
        }
      } catch {
        // The registry is already committed. Observer failures are contained
        // so later observers still run and the caller always receives its
        // withdrawal handle.
      }
    }
  }
}
