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
import type { UsageProviderRegistration, UsageRefreshPolicy, UsageSnapshotCollector } from '../usage/service.js'
import type { PrimarySearchBackend } from '../web-search/types.js'

/** The model plane: what makes providers interchangeable. */
export interface ModelCapability<TConfig> {
  /** Provider routes this adapter serves, as DSH resolves `provider:model`. */
  readonly routes: readonly string[]
  create(ctx: Context, config: TConfig): LlmAdapter
}

/**
 * Native web search. Absent means routing a search to this provider yields
 * an explicit unsupported error — never a silent fallback to another vendor.
 */
export interface WebSearchCapability<TConfig> {
  create(ctx: Context, config: TConfig): PrimarySearchBackend
}

/** What a usage capability may ask the core to do on its behalf. */
export interface UsageCapabilityHooks {
  /**
   * Drop this provider's cached snapshot. A vendor that pushes fresh usage
   * mid-session (Codex does, on every turn) calls this so the next read is
   * not served from a snapshot the vendor has already superseded.
   */
  invalidate(): void
}

/**
 * Usage and limits. Absent, or a collector that reports its own capability
 * class as unsupported, means the UI shows an honest row — never an error.
 */
export interface UsageCapability<TConfig> {
  /** Defaults to the core's shared policy when omitted. */
  readonly refreshPolicy?: UsageRefreshPolicy
  create(ctx: Context, config: TConfig, hooks: UsageCapabilityHooks): UsageSnapshotCollector
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
  /** The provider's own search backend, if its CLI has one. */
  readonly webSearch?: WebSearchCapability<TConfig>
  /** The provider's usage/limits source, if the vendor exposes anything to read. */
  readonly usage?: UsageCapability<TConfig>
  /** Anything else this provider needs wired up once the model is registered. */
  install?(ctx: Context, config: TConfig): void | Promise<void>
}

/** A registered provider as the core sees it. */
export interface RegisteredProvider {
  readonly id: string
  readonly routes: readonly string[]
  readonly descriptor: ProviderDescriptor<never>
  /**
   * Built at registration from `descriptor.webSearch`, on the provider's own
   * context, so the backend's subprocess work belongs to the provider plugin.
   */
  readonly webSearch?: PrimarySearchBackend
  /**
   * Built at registration from `descriptor.usage`, ready for the usage
   * service to register without knowing which provider it belongs to.
   */
  readonly usage?: Pick<UsageProviderRegistration, 'collector'> & { readonly refreshPolicy?: UsageRefreshPolicy }
}
