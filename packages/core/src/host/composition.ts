/**
 * Compose the host-plane usage service from whatever providers are
 * registered — and from nothing else.
 *
 * Before `0.1.0-rc.3` this module named three providers: it constructed one
 * source wrapper per vendor, wrote one registration branch per vendor, and
 * therefore had to be edited to add a fourth. Now every provider arrives
 * through the registry carrying its own collector, and this file has no
 * provider identity in it at all.
 *
 * @module nishi-dsh-core/host/composition
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  UsageLimitsService,
  UsageLimitsPublicFacade,
  type UsageClock,
  type UsageRefreshPolicy,
} from '../usage/index.js'

/**
 * The shared default. A provider declaring no policy of its own gets this
 * one, so "how often may we ask the vendor" is answered in one place.
 */
export const DEFAULT_USAGE_REFRESH_POLICY: UsageRefreshPolicy = Object.freeze({
  minRefreshIntervalMs: 60_000,
  staleAfterMs: 300_000,
})

export interface UsageLimitsHostDependencies {
  clock?: UsageClock
}

export interface UsageLimitsHostConfig extends UsageLimitsHostDependencies {
  /** Replaces the shared default for providers that declare no policy. */
  defaultRefreshPolicy?: UsageRefreshPolicy
}

export interface ComposedUsageHost {
  service: UsageLimitsService
  facade: UsageLimitsPublicFacade
}

export function composeUsageLimitsHost(
  ctx: Context,
  config?: UsageLimitsHostConfig,
  clock: UsageClock = () => Date.now(),
): ComposedUsageHost {
  const service = new UsageLimitsService([], clock)
  const facade = new UsageLimitsPublicFacade(service, clock)
  const defaultPolicy = config?.defaultRefreshPolicy ?? DEFAULT_USAGE_REFRESH_POLICY

  const registered = new Map<string, () => void>()

  /**
   * Bring the usage roster in line with the registry. Providers mount after
   * the core, and one may be unloaded while the browser is open, so the
   * roster is reconciled on every change rather than read once.
   */
  const reconcile = (): void => {
    const wanted = new Map(
      ctx.nishiProviders.all()
        .filter((provider) => provider.usage !== undefined)
        .map((provider) => [provider.id, provider] as const),
    )

    for (const [providerId, withdraw] of [...registered]) {
      if (wanted.has(providerId)) continue
      withdraw()
      registered.delete(providerId)
    }

    for (const [providerId, provider] of wanted) {
      if (registered.has(providerId)) continue
      const usage = provider.usage
      if (usage === undefined) continue
      registered.set(providerId, service.register({
        providerId,
        collector: usage.collector,
        policy: usage.refreshPolicy ?? defaultPolicy,
      }))
    }
  }

  reconcile()
  const stopWatchingRegistrations = ctx.nishiProviders.onChange(reconcile)
  const stopWatchingInvalidations = ctx.nishiProviders.onInvalidate((providerId) => {
    // A provider may report fresh usage while it is being unloaded, so an
    // invalidation for an already-withdrawn provider is expected, not an error.
    if (!registered.has(providerId)) return
    service.invalidate(providerId)
  })

  ctx.effect(() => () => {
    stopWatchingRegistrations()
    stopWatchingInvalidations()
    for (const withdraw of registered.values()) withdraw()
    registered.clear()
  }, 'nishi-core: stop tracking provider usage registrations')

  return { service, facade }
}
