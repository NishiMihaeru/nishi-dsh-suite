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
import { AntigravitySearchBackend } from './web-search-backend.js'
import { AntigravityUsageCollector } from './usage.js'
import { createHostPlatformDiscovery, HostAntigravityLocalUsageSource } from './usage-source.js'
import { AntigravityQuotaFallbackUsageSource, AntigravityQuotaHarvestCache } from './quota-harvest-cache.js'

export const name = 'antigravity'
export const inject = ['nishiProviders', 'subprocess', 'llm']

export const DEFAULT_ANTIGRAVITY_EXECUTABLE = 'agy'
export const DEFAULT_ANTIGRAVITY_EXECUTABLE_ENV = 'DSH_ANTIGRAVITY_CLI_EXECUTABLE'
export const DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS = 30_000
export const DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS = 30_000
export const DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES = 64_000
/**
 * Context capacity advertised for every `antigravity-cli` model.
 *
 * Not discovered: `agy models` discloses an id and a display name and
 * nothing else, and no vendor surface reports a per-model window. The figure
 * exists so automatic compaction runs at all -- `compaction-basic` refuses a
 * route with no capacity and swallows the refusal as a single warning, so an
 * unset window means unbounded history growth with no visible symptom. It is
 * deliberately below every current Gemini window: compacting earlier than
 * strictly necessary costs one extra fold, while not compacting costs the
 * whole session. Deployments that know their real window may raise it.
 */
export const DEFAULT_ANTIGRAVITY_CONTEXT_WINDOW_TOKENS = 200_000
/** Idle time after which a session's live `agy` child is reaped. */
export const DEFAULT_ANTIGRAVITY_SESSION_IDLE_MS = 15 * 60_000
/**
 * Timeout for one native `agy search_web` run. It lives here rather than on
 * the core's web-search tool because the vendor's own knobs belong to the
 * vendor's plugin; the tool keeps its separate per-call timeout.
 */
export const DEFAULT_ANTIGRAVITY_SEARCH_TIMEOUT_MS = 60_000

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
  searchTimeoutMs?: number
  env?: Record<string, string>
  modelCacheMs?: number
  catalogTimeoutMs?: number
  turnTimeoutMs?: number
  disposeGraceMs?: number
  stderrMaxBytes?: number
  contextWindowTokens?: number
  sessionIdleMs?: number
}

export const Config: Schema<Config> = Schema.object({
  executable: Schema.string().default(DEFAULT_ANTIGRAVITY_EXECUTABLE),
  env: Schema.dict(Schema.string()).default({}),
  modelCacheMs: Schema.number().default(DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS),
  catalogTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS),
  turnTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS),
  disposeGraceMs: Schema.number().default(DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS),
  stderrMaxBytes: Schema.number().default(DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES),
  searchTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_SEARCH_TIMEOUT_MS),
  contextWindowTokens: Schema.number().default(DEFAULT_ANTIGRAVITY_CONTEXT_WINDOW_TOKENS),
  sessionIdleMs: Schema.number().default(DEFAULT_ANTIGRAVITY_SESSION_IDLE_MS),
})

/** Config after merge-and-validate: every field is present, `executable` is Antigravity-specific. */
interface ResolvedAntigravityConfig extends SharedProviderDefaults {
  readonly executable: string
  readonly searchTimeoutMs: number
  readonly contextWindowTokens: number
  readonly sessionIdleMs: number
}

/**
 * Builds one Antigravity registration recipe, contributing three
 * capabilities through one descriptor: the `antigravity-cli` primary model
 * route, native `agy search_web`, and the local usage-visibility source.
 *
 * The primary adapter has a clean `create(): LlmAdapter` — it is built by
 * `createAntigravityPrimaryAdapter(ctx, config)` — while the shared core
 * registration path owns route registration and rollback. Search and usage
 * are likewise constructed from this provider's context, so their subprocess
 * lifetimes remain provider-owned.
 *
 * This is a function rather than a module-level constant specifically so
 * `quotaHarvestCache` can be constructed fresh per `apply()` call and closed
 * over by both `model.create` (which feeds it from the primary adapter's own
 * `agy` child) and `usage.create` (which reads it as a fallback): a
 * module-level singleton here would leak a harvested reading between
 * separate plugin instances (e.g. two independent `apply()` calls in tests,
 * or if this provider were ever registered twice), which is exactly the kind
 * of cross-instance state this package otherwise avoids.
 */
function buildAntigravityDescriptor(): ProviderDescriptor<ResolvedAntigravityConfig> {
  const platformDiscovery = createHostPlatformDiscovery()
  const quotaHarvestCache = new AntigravityQuotaHarvestCache({
    // PID-scoped only: this resolves listeners for one PID this package
    // itself just spawned, never by scanning other processes' command
    // lines. See quota-harvest-cache.ts's module doc for the full trust
    // argument.
    discoverListeners: (pid) => platformDiscovery.discoverListeners?.(pid) ?? Promise.resolve([]),
  })

  return {
    id: 'antigravity',
    presentation: {
      id: 'antigravity',
      displayName: 'Antigravity',
      brandColor: '#4E82EE',
      iconPath: 'M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z',
      // One Antigravity account is really several vendor pools, and its usage
      // reports them as BUCKET-scoped windows with their own names.
      bucketsAsPools: true,
    },
    executable: ANTIGRAVITY_DESCRIPTOR,
    model: {
      routes: [ANTIGRAVITY_PRIMARY_PROVIDER],
      create: (ctx, config) => createAntigravityPrimaryAdapter(ctx, config, quotaHarvestCache),
    },
    usage: {
      /**
       * Antigravity exposes no official machine-readable usage, so the
       * primary source reports an observation about what it could see
       * locally and the normalizer turns that into an honest
       * `UNSUPPORTED_NUMERIC_USAGE` row rather than an error or a
       * fabricated number. `AntigravityQuotaFallbackUsageSource` only steps
       * in when that primary source finds no running Antigravity surface at
       * all (`UNAVAILABLE`): see quota-harvest-cache.ts for exactly when it
       * does and does not override the primary result.
       */
      create: () => new AntigravityUsageCollector(
        new AntigravityQuotaFallbackUsageSource(new HostAntigravityLocalUsageSource(), quotaHarvestCache),
      ),
    },
    webSearch: {
      create: (ctx, config) => new AntigravitySearchBackend(ctx, {
        executable: config.executable,
        env: config.env,
        timeoutMs: config.searchTimeoutMs,
        disposeGraceMs: config.disposeGraceMs,
        stderrMaxBytes: config.stderrMaxBytes,
      }),
    },
  }
}

export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const executable = rawConfig.executable ?? DEFAULT_ANTIGRAVITY_EXECUTABLE
  if (executable.trim().length === 0) throw new Error('antigravity: executable must be non-empty')

  const shared = resolveSharedProviderConfig('antigravity', rawConfig, DEFAULT_ANTIGRAVITY_SHARED_CONFIG)

  const searchTimeoutMs = rawConfig.searchTimeoutMs ?? DEFAULT_ANTIGRAVITY_SEARCH_TIMEOUT_MS
  if (!Number.isSafeInteger(searchTimeoutMs) || searchTimeoutMs < 1) {
    throw new Error('antigravity: searchTimeoutMs must be a positive integer')
  }

  const contextWindowTokens = rawConfig.contextWindowTokens ?? DEFAULT_ANTIGRAVITY_CONTEXT_WINDOW_TOKENS
  if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens < 1) {
    throw new Error('antigravity: contextWindowTokens must be a positive integer')
  }

  const sessionIdleMs = rawConfig.sessionIdleMs ?? DEFAULT_ANTIGRAVITY_SESSION_IDLE_MS
  if (!Number.isSafeInteger(sessionIdleMs) || sessionIdleMs < 1) {
    throw new Error('antigravity: sessionIdleMs must be a positive integer')
  }

  const config: ResolvedAntigravityConfig = {
    ...shared,
    executable,
    searchTimeoutMs,
    contextWindowTokens,
    sessionIdleMs,
  }

  await registerProvider(ctx, buildAntigravityDescriptor(), config)
}
