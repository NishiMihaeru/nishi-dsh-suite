/**
 * The single registration path every subscription-CLI provider plugin uses.
 *
 * Before this module existed, provider packages each hand-rolled the same
 * merge/validate/register sequence. This module owns that sequence once:
 * `resolveSharedProviderConfig` owns the six shared configuration fields and
 * `registerProvider` owns provider identity/capability registration order.
 *
 * Delegation left the contract in `0.1.0-rc.3`: no provider contributes a
 * subagent provider any more, so there is no subagent step here to run.
 *
 * See `docs/ARCHITECTURE.md` for the current contract this module implements.
 *
 * @module nishi-dsh-core/runtime/registration
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ProviderDescriptor } from '../registry/descriptor.js'
import { canonicalProviderId, canonicalProviderRoute } from '../registry/identity.js'
import { parseUsageRefreshPolicy, parseUsageSnapshotCollector } from '../usage/service.js'

/** Config fields every subscription-CLI provider plugin shares. */
export interface SharedProviderConfig {
  /** Explicit environment layered over DSH's credential-scrubbed child environment. */
  env?: Record<string, string>
  /** Milliseconds to retain one successful model catalog. May be `0` to disable caching. */
  modelCacheMs?: number
  /** Milliseconds allowed for login and model discovery. */
  catalogTimeoutMs?: number
  /** Milliseconds allowed for one turn. */
  turnTimeoutMs?: number
  /** Grace between managed subprocess termination tiers. */
  disposeGraceMs?: number
  /** Maximum stderr bytes retained for a failure diagnostic. */
  stderrMaxBytes?: number
}

/** `SharedProviderConfig` with every field required — the shape after defaulting. */
export type SharedProviderDefaults = Required<SharedProviderConfig>

function assertPositiveFinite(id: string, field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${id}: ${field} must be a positive finite number`)
  }
}

/**
 * Merge `raw` over `defaults` and validate the six shared fields in one
 * place, with one rule set:
 *
 * - `catalogTimeoutMs`, `turnTimeoutMs`, and `disposeGraceMs` must be
 *   positive finite numbers no greater than `MAX_TIMER_DELAY_MS` — they are
 *   all handed to a timer.
 * - `stderrMaxBytes` must be a positive finite number. It bounds a byte
 *   count, not a timer, so it is not capped at `MAX_TIMER_DELAY_MS`.
 * - `modelCacheMs` must be a non-negative finite number — `0` is a valid
 *   "never cache" value, so it is checked separately from the positive
 *   timers above.
 * - `env` passes through unvalidated; `Config` schemas already constrain it
 *   to a string dictionary.
 */
export function resolveSharedProviderConfig(
  id: string,
  raw: SharedProviderConfig,
  defaults: SharedProviderDefaults,
): SharedProviderDefaults {
  const config: SharedProviderDefaults = {
    env: raw.env ?? defaults.env,
    modelCacheMs: raw.modelCacheMs ?? defaults.modelCacheMs,
    catalogTimeoutMs: raw.catalogTimeoutMs ?? defaults.catalogTimeoutMs,
    turnTimeoutMs: raw.turnTimeoutMs ?? defaults.turnTimeoutMs,
    disposeGraceMs: raw.disposeGraceMs ?? defaults.disposeGraceMs,
    stderrMaxBytes: raw.stderrMaxBytes ?? defaults.stderrMaxBytes,
  }

  if (!Number.isFinite(config.modelCacheMs) || config.modelCacheMs < 0) {
    throw new Error(`${id}: modelCacheMs must be non-negative and finite`)
  }
  const timersAndByteCount = [
    ['catalogTimeoutMs', config.catalogTimeoutMs],
    ['turnTimeoutMs', config.turnTimeoutMs],
    ['disposeGraceMs', config.disposeGraceMs],
    ['stderrMaxBytes', config.stderrMaxBytes],
  ] as const
  for (const [field, value] of timersAndByteCount) {
    assertPositiveFinite(id, field, value)
    if (field !== 'stderrMaxBytes' && value > MAX_TIMER_DELAY_MS) {
      throw new Error(`${id}: ${field} must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
  }

  return config
}

async function rollbackRegistration(
  providerId: string,
  originalError: unknown,
  disposeAdapter: (() => void) | undefined,
  disposeRegistryEffect: (() => void | Promise<void>) | undefined,
  forgetRegistry: (() => void) | undefined,
): Promise<never> {
  const rollbackErrors: unknown[] = []

  if (disposeAdapter !== undefined) {
    try {
      disposeAdapter()
    } catch (error) {
      rollbackErrors.push(error)
    }
  }

  if (disposeRegistryEffect !== undefined) {
    try {
      await disposeRegistryEffect()
    } catch (error) {
      rollbackErrors.push(error)
    }
  } else if (forgetRegistry !== undefined) {
    // `ctx.effect()` itself may fail after the registry entry was recorded.
    // In that case no effect disposer exists yet, so withdraw directly.
    try {
      forgetRegistry()
    } catch (error) {
      rollbackErrors.push(error)
    }
  }

  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      `${providerId}: provider registration failed and rollback did not complete cleanly`,
      { cause: originalError },
    )
  }
  throw originalError
}

/** Validate a capability descriptor's own shape before its `create` runs. */
function assertCapabilityDescriptor(
  providerId: string,
  field: 'webSearch' | 'usage',
  value: { create?: unknown },
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${providerId}: ${field} must be a non-null object`)
  }
  if (typeof value.create !== 'function') {
    throw new Error(`${providerId}: ${field}.create must be a function`)
  }
}

/** Keep adapter behavior intact while filtering only advertised models. */
export function withModelVisibility(
  adapter: LlmAdapter,
  isVisible: (provider: string, model: string) => boolean,
): LlmAdapter {
  return new Proxy(adapter, {
    get(target, property) {
      if (property === 'listModels' && typeof target.listModels === 'function') {
        return async (provider: string) => {
          const models = await target.listModels(provider)
          return models.filter((model) => isVisible(provider, model.id))
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * The single registration path every provider goes through: validate its
 * identity and provider-owned usage contract first, construct provider-owned
 * search/usage capabilities, record the provider, register its model route,
 * then run provider-specific install.
 *
 * Identity/policy validation happens before any capability factory runs: the
 * shape of a present `webSearch`/`usage` descriptor is checked before its
 * `create` is called, and the collector the usage factory returns is
 * validated before registry mutation. Once core state starts mutating,
 * registration is transactional for the resources the core directly owns:
 * the registry entry and LLM adapter. The `webSearch`/`usage` instances
 * themselves are built on the provider's own context and carry no dispose
 * contract here — a provider that opens resources for them is responsible
 * for binding that lifecycle to its own `ctx.effect()` so plugin unload
 * tears it down; this function does not roll them back. Registry change
 * listeners are observers and cannot veto a committed record.
 */
export async function registerProvider<TConfig extends SharedProviderConfig>(
  ctx: Context,
  descriptor: ProviderDescriptor<TConfig>,
  config: TConfig,
): Promise<void> {
  const providerId = canonicalProviderId(descriptor.id, 'provider descriptor.id')
  const registry = ctx.nishiProviders
  if (registry === undefined) {
    throw new Error(
      `${providerId}: the nishi-dsh-core row must be mounted before a provider plugin — declare inject: ['nishiProviders']`,
    )
  }

  const presentationId = canonicalProviderId(descriptor.presentation.id, `${providerId}: presentation.id`)
  if (presentationId !== providerId) {
    throw new Error(
      `${providerId}: presentation.id must match the provider id (got "${descriptor.presentation.id}")`,
    )
  }

  const routes: string[] = []
  const seenRoutes = new Set<string>()
  for (const [index, rawRoute] of (descriptor.model?.routes ?? []).entries()) {
    const route = canonicalProviderRoute(rawRoute, `${providerId}: model.routes[${index}]`)
    if (seenRoutes.has(route)) {
      throw new Error(`${providerId}: model.routes declares duplicate route "${route}"`)
    }
    seenRoutes.add(route)
    routes.push(route)
  }

  if (descriptor.model && routes.length === 0) {
    throw new Error(`${providerId}: a provider declaring a model capability must declare at least one route`)
  }

  const refreshPolicy = descriptor.usage?.refreshPolicy === undefined
    ? undefined
    : parseUsageRefreshPolicy(descriptor.usage.refreshPolicy, `${providerId}: usage.refreshPolicy`)

  if (descriptor.webSearch !== undefined) {
    assertCapabilityDescriptor(providerId, 'webSearch', descriptor.webSearch)
  }
  if (descriptor.usage !== undefined) {
    assertCapabilityDescriptor(providerId, 'usage', descriptor.usage)
  }

  const webSearch = descriptor.webSearch?.create(ctx, config)
  const usage = descriptor.usage === undefined
    ? undefined
    : {
        collector: parseUsageSnapshotCollector(
          descriptor.usage.create(ctx, config, {
            invalidate: () => registry.invalidate(providerId),
          }),
          `${providerId}: usage.collector`,
        ),
        ...(refreshPolicy === undefined ? {} : { refreshPolicy }),
      }

  let forgetRegistry: (() => void) | undefined
  let disposeRegistryEffect: (() => void | Promise<void>) | undefined
  let disposeAdapter: (() => void) | undefined
  let rawAdapter: LlmAdapter | undefined

  try {
    forgetRegistry = registry.record({
      id: providerId,
      presentation: descriptor.presentation,
      routes,
      descriptor: descriptor as ProviderDescriptor<never>,
      ...(webSearch === undefined ? {} : { webSearch }),
      ...(usage === undefined ? {} : { usage }),
    })

    disposeRegistryEffect = ctx.effect(
      () => forgetRegistry!,
      `${providerId}: withdraw provider registration`,
    )

    if (descriptor.model !== undefined) {
      rawAdapter = descriptor.model.create(ctx, config)
      if (typeof rawAdapter.listModels === 'function' && typeof registry.setModelLister === 'function') {
        registry.setModelLister(providerId, rawAdapter.listModels.bind(rawAdapter))
      }
      const adapter = typeof rawAdapter.listModels === 'function'
        ? withModelVisibility(rawAdapter, (provider, model) => registry.isModelVisible(provider, model))
        : rawAdapter
      disposeAdapter = ctx.llm.registerAdapter(routes, adapter)
    }

    await descriptor.install?.(ctx, config)
  } catch (error) {
    await rollbackRegistration(
      providerId,
      error,
      disposeAdapter,
      disposeRegistryEffect,
      forgetRegistry,
    )
  }
}
