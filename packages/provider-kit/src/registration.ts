/**
 * The single registration path every subscription-CLI provider plugin uses.
 *
 * Before this module existed, `nishi-dsh-codex` and `nishi-dsh-antigravity`
 * each hand-rolled the same four steps in their `apply()`: merge raw config
 * over defaults field-by-field, validate the timer/byte-count fields with
 * the same rules and near-identical message wording, register a subagent
 * provider, then register an LLM adapter (Codex hid the adapter step inside
 * a nested `applyCodexPrimary` call; Antigravity did it inline). This module
 * is that sequence, written once: `resolveSharedProviderConfig` owns the
 * merge-and-validate step for the six config fields every provider shares,
 * and `registerProvider` owns the fixed subagent-then-model-then-extras
 * registration order both providers already followed by hand.
 *
 * See `docs/superpowers/specs/provider-bridge-design.md` ("The kit") for
 * the design this package implements.
 *
 * @module nishi-dsh-provider-kit/registration
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { assertPositiveFinite, type SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { VendorExecutableDescriptor } from './executable.js'

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
 * `subagent-codex`) — exactly as both providers' hand-written checks did
 * before this module existed.
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
 * One provider's registration recipe: identity, executable lookup facts
 * (for callers that want to describe or resolve the vendor CLI), and the
 * seams `registerProvider` wires up. `TConfig` is the provider's own fully
 * resolved config — its `SharedProviderConfig` fields plus whatever fields
 * are specific to that provider.
 */
export interface ProviderDescriptor<TConfig extends SharedProviderConfig> {
  /** Stable plugin id, used as the validation-diagnostic prefix (e.g. `subagent-codex`). */
  readonly id: string
  /** Identity and lookup facts for this provider's vendor CLI executable. */
  readonly executable: VendorExecutableDescriptor
  /** The subagent provider this plugin contributes to `ctx.subagents`, if any. */
  readonly subagent?: { create(ctx: Context, config: TConfig): SubagentProvider }
  /** The LLM adapter this plugin contributes to `ctx.llm`, and the provider routes it serves, if any. */
  readonly model?: { readonly routes: readonly string[]; create(ctx: Context, config: TConfig): LlmAdapter }
  /** Anything else this provider needs wired up once the subagent and model are registered. */
  install?(ctx: Context, config: TConfig): void | Promise<void>
}

/**
 * The single registration path every provider goes through: register the
 * subagent provider (if any), register the LLM adapter under its routes
 * (if any), then run provider-specific extras. This order matches what
 * both Codex and Antigravity did by hand before this module existed —
 * subagent first, then primary/adapter, then extras (e.g. history bridges)
 * that may assume the adapter is already registered.
 */
export async function registerProvider<TConfig extends SharedProviderConfig>(
  ctx: Context,
  descriptor: ProviderDescriptor<TConfig>,
  config: TConfig,
): Promise<void> {
  if (descriptor.subagent) {
    ctx.subagents.registerProvider(descriptor.subagent.create(ctx, config))
  }
  if (descriptor.model) {
    ctx.llm.registerAdapter([...descriptor.model.routes], descriptor.model.create(ctx, config))
  }
  await descriptor.install?.(ctx, config)
}
