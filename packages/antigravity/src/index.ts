/**
 * Antigravity primary provider plugin: the `agy` CLI bridge.
 *
 * Delegation was removed in `0.1.0-rc.3`. The managed Antigravity child agent
 * could not use tools at all in headless mode — the CLI auto-denied every
 * permission it could not prompt for — and its project-memory access was a
 * prompt prefix rather than a tool, so it was the weakest of the two delegated
 * planes and is gone with them both.
 *
 * @module nishi-dsh-antigravity
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  registerProvider,
  resolveSharedProviderConfig,
  type ProviderDescriptor,
  type SharedProviderDefaults,
  type VendorExecutableDescriptor,
} from 'nishi-dsh-core/runtime'
import { ANTIGRAVITY_PRIMARY_PROVIDER, createAntigravityPrimaryAdapter } from './antigravity-primary.js'

export const name = 'antigravity'
export const inject = ['nishiProviders', 'subprocess', 'llm']

export const DEFAULT_ANTIGRAVITY_EXECUTABLE = 'agy'
export const DEFAULT_ANTIGRAVITY_EXECUTABLE_ENV = 'DSH_ANTIGRAVITY_CLI_EXECUTABLE'
export const DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS = 30_000
export const DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS = 30_000
export const DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES = 64_000

/** Identity and lookup facts for the Antigravity CLI executable. */
const ANTIGRAVITY_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'antigravity',
  defaultName: DEFAULT_ANTIGRAVITY_EXECUTABLE,
  envOverride: DEFAULT_ANTIGRAVITY_EXECUTABLE_ENV,
  productName: 'Antigravity CLI',
}

/** Fields shared by every subscription-CLI provider, defaulted for Antigravity. */
const DEFAULT_ANTIGRAVITY_SHARED_CONFIG: SharedProviderDefaults = {
  env: {},
  modelCacheMs: DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS,
  catalogTimeoutMs: DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS,
  turnTimeoutMs: DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS,
  disposeGraceMs: DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS,
  stderrMaxBytes: DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES,
}

export interface Config {
  executable?: string
  env?: Record<string, string>
  modelCacheMs?: number
  catalogTimeoutMs?: number
  turnTimeoutMs?: number
  disposeGraceMs?: number
  stderrMaxBytes?: number
}

export const Config: Schema<Config> = Schema.object({
  executable: Schema.string().default(DEFAULT_ANTIGRAVITY_EXECUTABLE),
  env: Schema.dict(Schema.string()).default({}),
  modelCacheMs: Schema.number().default(DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS),
  catalogTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS),
  turnTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS),
  disposeGraceMs: Schema.number().default(DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS),
  stderrMaxBytes: Schema.number().default(DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES),
})

/** Config after merge-and-validate: every field is present, `executable` is Antigravity-specific. */
interface ResolvedAntigravityConfig extends SharedProviderDefaults {
  readonly executable: string
}

/**
 * The Antigravity registration recipe: the `AntigravityCliAdapter` as the
 * `antigravity-cli` model route, and nothing else.
 *
 * Unlike Codex, the adapter here has a clean `create(): LlmAdapter` — it is
 * just `new AntigravityCliAdapter(ctx, config)` — so `model` is populated
 * directly instead of falling back to `install`. The adapter's dispose
 * effect is bound inside `createAntigravityPrimaryAdapter`, which the live
 * suite drives directly so it exercises the same object production does.
 */
const antigravityDescriptor: ProviderDescriptor<ResolvedAntigravityConfig> = {
  id: 'antigravity',
  executable: ANTIGRAVITY_DESCRIPTOR,
  model: {
    routes: [ANTIGRAVITY_PRIMARY_PROVIDER],
    create: (ctx, config) => createAntigravityPrimaryAdapter(ctx, config),
  },
}

export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const executable = rawConfig.executable ?? DEFAULT_ANTIGRAVITY_EXECUTABLE
  if (executable.trim().length === 0) throw new Error('antigravity: executable must be non-empty')

  const shared = resolveSharedProviderConfig('antigravity', rawConfig, DEFAULT_ANTIGRAVITY_SHARED_CONFIG)

  const config: ResolvedAntigravityConfig = { ...shared, executable }

  await registerProvider(ctx, antigravityDescriptor, config)
}
