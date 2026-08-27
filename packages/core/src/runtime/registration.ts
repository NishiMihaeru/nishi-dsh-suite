/**
 * The single registration path every subscription-CLI provider plugin uses.
 *
 * Before this module existed, `nishi-dsh-codex` and `nishi-dsh-antigravity`
 * each hand-rolled the same steps in their `apply()`: merge raw config over
 * defaults field-by-field, validate the timer/byte-count fields with the
 * same rules and near-identical message wording, then register their seams.
 * This module is that sequence, written once: `resolveSharedProviderConfig`
 * owns the merge-and-validate step for the six config fields every provider
 * shares, and `registerProvider` owns the model-then-extras registration
 * order both providers already followed by hand.
 *
 * Delegation left the contract in `0.1.0-rc.3`: no provider contributes a
 * subagent provider any more, so there is no subagent step here to run.
 *
 * See `docs/superpowers/specs/provider-bridge-design.md` for the design this
 * module implements.
 *
 * @module nishi-dsh-core/runtime/registration
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertPositiveFinite } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ProviderDescriptor } from '../registry/descriptor.js'

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
 *
 * Every diagnostic is prefixed with `id` — the calling plugin's name (e.g.
 * `codex`) — exactly as both providers' hand-written checks did before this
 * module existed.
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

/**
 * The single registration path every provider goes through: record the
 * provider in the core's registry, register its LLM adapter under the routes
 * it declares, then run provider-specific extras.
 *
 * The provider's own `ctx` does the registering, not the core's: the adapter
 * binds session listeners and a dispose effect, and those must belong to the
 * provider plugin so unloading it takes them with it. The registry entry is
 * removed by the same effect for the same reason.
 *
 * Extras run last because they may assume the adapter is already registered —
 * the Codex primary history bridge does.
 */
export async function registerProvider<TConfig extends SharedProviderConfig>(
  ctx: Context,
  descriptor: ProviderDescriptor<TConfig>,
  config: TConfig,
): Promise<void> {
  const registry = ctx.nishiProviders
  if (registry === undefined) {
    throw new Error(
      `${descriptor.id}: the nishi-dsh-core row must be mounted before a provider plugin — declare inject: ['nishiProviders']`,
    )
  }

  const routes = descriptor.model ? [...descriptor.model.routes] : []
  if (descriptor.model && routes.length === 0) {
    throw new Error(`${descriptor.id}: a provider declaring a model capability must declare at least one route`)
  }

  const forget = registry.record({
    id: descriptor.id,
    routes,
    descriptor: descriptor as ProviderDescriptor<never>,
  })
  ctx.effect(() => forget, `${descriptor.id}: withdraw provider registration`)

  if (descriptor.model) {
    ctx.llm.registerAdapter(routes, descriptor.model.create(ctx, config))
  }
  await descriptor.install?.(ctx, config)
}
