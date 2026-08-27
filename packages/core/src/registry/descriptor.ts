/**
 * What one provider declares about itself.
 *
 * The core learns every provider through this record and nothing else: it
 * holds identity, the routes the provider serves, the vendor CLI lookup
 * facts, and the capabilities the vendor actually supports. Capabilities are
 * added to this type by the task that consumes them, so a field here is
 * always one somebody reads.
 *
 * @module nishi-dsh-core/registry/descriptor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { VendorExecutableDescriptor } from '../runtime/executable.js'
import type { SharedProviderConfig } from '../runtime/registration.js'

/** The model plane: what makes providers interchangeable. */
export interface ModelCapability<TConfig> {
  /** Provider routes this adapter serves, as DSH resolves `provider:model`. */
  readonly routes: readonly string[]
  create(ctx: Context, config: TConfig): LlmAdapter
}

/**
 * One provider's registration recipe.
 *
 * `TConfig` is the provider's own fully resolved config — its
 * `SharedProviderConfig` fields plus whatever is specific to that provider.
 */
export interface ProviderDescriptor<TConfig extends SharedProviderConfig> {
  /** Canonical provider id, one per provider, also the diagnostic prefix (e.g. `codex`). */
  readonly id: string
  /** Identity and lookup facts for this provider's vendor CLI executable. */
  readonly executable: VendorExecutableDescriptor
  /**
   * The primary plane. Absent means the provider is not selectable as a
   * primary — a usage-only provider is a legal, declared state.
   */
  readonly model?: ModelCapability<TConfig>
  /** Anything else this provider needs wired up once the model is registered. */
  install?(ctx: Context, config: TConfig): void | Promise<void>
}

/** A registered provider as the core sees it. */
export interface RegisteredProvider {
  readonly id: string
  readonly routes: readonly string[]
  readonly descriptor: ProviderDescriptor<never>
}
