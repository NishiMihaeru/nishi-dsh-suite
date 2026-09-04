/**
 * Grok primary provider plugin: the Grok Build CLI bridge.
 *
 * Three capabilities, declared because the vendor actually has them: the
 * `grok-cli` primary model route, Usage & Limits from ACP `_x.ai/billing`,
 * and a native `web_search` backend for Core's routed search tool.
 *
 * `/usage` is still not a quota channel — it is a TUI billing action, absent
 * from the session's advertised command list, and passing it to the headless
 * entry sends it to the model as prose (measured: the turn ended `cancelled`
 * after 13,420 input tokens). The machine-readable channel is the vendor
 * extension `_x.ai/billing`, answered after `initialize` with no session and
 * no turn. A reading with no finite percentage inside an open period stays
 * an honest `UNAVAILABLE` rather than invented headroom.
 *
 * Search is a separate hidden headless turn, not the primary process. The
 * primary argv still passes `--disable-web-search` as part of its isolation
 * posture. The search backend allowlists `web_search` only, reads the
 * Messages stream so native search can be proven (the `json` envelope's
 * `web_search_requests` counter stays 0 on the client-side tool), and never
 * passes `--always-approve`. The search agent is pinned to `grok-4.5` at
 * `low` effort regardless of the session's primary model: the native tool
 * does the retrieval, and a 4.6/xhigh session must not spend that on a
 * schema wrapper.
 *
 * @module nishi-dsh-grok
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
import { GrokCliAdapter, GROK_PRIMARY_PROVIDER } from './grok-primary.js'
import { GrokUsageCollector } from './usage.js'
import { GrokUsageBillingSource } from './usage-billing.js'
import { GrokSearchBackend } from './web-search-backend.js'

export const name = 'grok'
export const inject = ['nishiProviders', 'subprocess', 'llm']

export const DEFAULT_GROK_EXECUTABLE = 'grok'
export const DEFAULT_GROK_EXECUTABLE_ENV = 'DSH_GROK_CLI_EXECUTABLE'
export const DEFAULT_GROK_MODEL_CACHE_MS = 30_000
export const DEFAULT_GROK_CATALOG_TIMEOUT_MS = 30_000
export const DEFAULT_GROK_TURN_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_GROK_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_GROK_STDERR_MAX_BYTES = 64_000
/**
 * Context capacity used only for a model the vendor's handshake did not
 * describe.
 *
 * Normally unused: the ACP `initialize` response carries `totalContextTokens`
 * per model, so this route reads the real window instead of configuring one.
 * The fallback is deliberately conservative, because the two errors are not
 * symmetric -- compacting earlier than strictly necessary costs one extra
 * fold, while not compacting at all costs the session.
 */
export const DEFAULT_GROK_CONTEXT_WINDOW_TOKENS = 200_000
/**
 * Vendor agent rounds allowed inside one DSH step.
 *
 * DSH owns the loop, so this is a backstop rather than a budget: one round
 * answers, and the rest exist because the vendor spends a round on its own
 * structured-output retry when the model first answers outside the schema.
 * It was `1`, and the first real DSH request died on it -- the vendor reported
 * `stopReason: "cancelled"` with `Error: max turns reached`, which reaches a
 * user as "the turn was cancelled" and says nothing about the cap.
 */
export const DEFAULT_GROK_VENDOR_TURN_CAP = 4
/**
 * Timeout for one native Grok `web_search` run. It lives here rather than on
 * the core's web-search tool because the vendor's own knobs belong to the
 * vendor's plugin; the tool keeps its separate per-call timeout.
 */
export const DEFAULT_GROK_SEARCH_TIMEOUT_MS = 60_000

/** Identity and lookup facts for the Grok Build CLI executable. */
const GROK_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'grok',
  defaultName: DEFAULT_GROK_EXECUTABLE,
  envOverride: DEFAULT_GROK_EXECUTABLE_ENV,
  productName: 'Grok Build CLI',
}

/** Fields shared by every subscription-CLI provider, defaulted for Grok. */
const DEFAULT_GROK_SHARED_CONFIG: SharedProviderDefaults = {
  env: {},
  modelCacheMs: DEFAULT_GROK_MODEL_CACHE_MS,
  catalogTimeoutMs: DEFAULT_GROK_CATALOG_TIMEOUT_MS,
  turnTimeoutMs: DEFAULT_GROK_TURN_TIMEOUT_MS,
  disposeGraceMs: DEFAULT_GROK_DISPOSE_GRACE_MS,
  stderrMaxBytes: DEFAULT_GROK_STDERR_MAX_BYTES,
}

export interface Config {
  executable?: string
  env?: Record<string, string>
  modelCacheMs?: number
  catalogTimeoutMs?: number
  turnTimeoutMs?: number
  disposeGraceMs?: number
  stderrMaxBytes?: number
  contextWindowTokens?: number
  vendorTurnCap?: number
  searchTimeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  executable: Schema.string().default(DEFAULT_GROK_EXECUTABLE),
  env: Schema.dict(Schema.string()).default({}),
  modelCacheMs: Schema.number().default(DEFAULT_GROK_MODEL_CACHE_MS),
  catalogTimeoutMs: Schema.number().default(DEFAULT_GROK_CATALOG_TIMEOUT_MS),
  turnTimeoutMs: Schema.number().default(DEFAULT_GROK_TURN_TIMEOUT_MS),
  disposeGraceMs: Schema.number().default(DEFAULT_GROK_DISPOSE_GRACE_MS),
  stderrMaxBytes: Schema.number().default(DEFAULT_GROK_STDERR_MAX_BYTES),
  contextWindowTokens: Schema.number().default(DEFAULT_GROK_CONTEXT_WINDOW_TOKENS),
  vendorTurnCap: Schema.number().default(DEFAULT_GROK_VENDOR_TURN_CAP),
  searchTimeoutMs: Schema.number().default(DEFAULT_GROK_SEARCH_TIMEOUT_MS),
})

/** Config after merge-and-validate: every field present, `executable` Grok-specific. */
interface ResolvedGrokConfig extends SharedProviderDefaults {
  readonly executable: string
  readonly contextWindowTokens: number
  readonly vendorTurnCap: number
  readonly searchTimeoutMs: number
}

const grokDescriptor: ProviderDescriptor<ResolvedGrokConfig> = {
  id: 'grok',
  presentation: {
    id: 'grok',
    displayName: 'Grok Build CLI',
    /**
     * Neutral, and no `iconPath` at all.
     *
     * xAI's Brand Guidelines permit using their marks "only to accurately
     * refer to us or our services" and allow logos to be used "only ... exactly
     * as provided ... without any alteration". A display name that names the
     * vendor's own product being driven is accurate reference; a redrawn glyph
     * and a borrowed brand colour are not, so this row renders the neutral
     * mark. See the terms section of `docs/verification/grok-cli-contract.md`.
     */
    brandColor: '#6B7280',
  },
  executable: GROK_DESCRIPTOR,
  model: {
    routes: [GROK_PRIMARY_PROVIDER],
    create: (ctx, config) => new GrokCliAdapter(ctx, {
      executable: config.executable,
      env: config.env,
      modelCacheMs: config.modelCacheMs,
      catalogTimeoutMs: config.catalogTimeoutMs,
      turnTimeoutMs: config.turnTimeoutMs,
      disposeGraceMs: config.disposeGraceMs,
      stderrMaxBytes: config.stderrMaxBytes,
      contextWindowTokens: config.contextWindowTokens,
      vendorTurnCap: config.vendorTurnCap,
    }),
  },
  usage: {
    /**
     * Quota comes from ACP `_x.ai/billing` over `grok agent stdio`: after
     * `initialize`, no session, no turn, the weekly credit percentage and
     * its open period. `/usage` is still a TUI-only action and is not this
     * channel.
     *
     * A reading with no finite percentage inside an open period stays an
     * honest `UNAVAILABLE` rather than invented headroom. Prepaid/on-demand
     * fields are not projected: they have been seen only as `{val: 0}` with
     * no unit.
     */
    create: (ctx, config) => new GrokUsageCollector(new GrokUsageBillingSource(ctx, {
      executable: config.executable,
      env: config.env,
      disposeGraceMs: config.disposeGraceMs,
      timeoutMs: config.catalogTimeoutMs,
      stderrMaxBytes: config.stderrMaxBytes,
    })),
  },
  webSearch: {
    create: (ctx, config) => new GrokSearchBackend(ctx, {
      executable: config.executable,
      env: config.env,
      timeoutMs: config.searchTimeoutMs,
      disposeGraceMs: config.disposeGraceMs,
      stderrMaxBytes: config.stderrMaxBytes,
    }),
  },
}

export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const executable = rawConfig.executable ?? DEFAULT_GROK_EXECUTABLE
  if (executable.trim().length === 0) throw new Error('grok: executable must be non-empty')

  const shared = resolveSharedProviderConfig('grok', rawConfig, DEFAULT_GROK_SHARED_CONFIG)

  const contextWindowTokens = rawConfig.contextWindowTokens ?? DEFAULT_GROK_CONTEXT_WINDOW_TOKENS
  if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens < 1) {
    throw new Error('grok: contextWindowTokens must be a positive integer')
  }

  const vendorTurnCap = rawConfig.vendorTurnCap ?? DEFAULT_GROK_VENDOR_TURN_CAP
  if (!Number.isSafeInteger(vendorTurnCap) || vendorTurnCap < 1) {
    throw new Error('grok: vendorTurnCap must be a positive integer')
  }

  const searchTimeoutMs = rawConfig.searchTimeoutMs ?? DEFAULT_GROK_SEARCH_TIMEOUT_MS
  if (!Number.isSafeInteger(searchTimeoutMs) || searchTimeoutMs < 1) {
    throw new Error('grok: searchTimeoutMs must be a positive integer')
  }

  const config: ResolvedGrokConfig = {
    ...shared,
    executable,
    contextWindowTokens,
    vendorTurnCap,
    searchTimeoutMs,
  }

  await registerProvider(ctx, grokDescriptor, config)
}

export { GrokCliAdapter, GROK_PRIMARY_PROVIDER } from './grok-primary.js'
export { GrokUsageCollector, GrokUsageSourceError } from './usage.js'
export { GrokUsageBillingSource, GROK_BILLING_METHOD } from './usage-billing.js'
export {
  GrokSearchBackend,
  GrokWebSearchBackendError,
  SEARCH_VENDOR_TURN_CAP,
} from './web-search-backend.js'
export { SEARCH_EFFORT, SEARCH_MODEL } from './grok-vendor.js'
