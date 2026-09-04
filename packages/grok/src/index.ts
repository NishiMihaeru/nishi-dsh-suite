/**
 * Grok primary provider plugin: the Grok Build CLI bridge.
 *
 * One capability, declared because the vendor actually has it: the `grok-cli`
 * primary model route. Two are deliberately absent.
 *
 * There is no usage capability, and that is a finding rather than an omission.
 * This vendor publishes no machine-readable quota channel at all: `/usage` is
 * a TUI billing action, it is absent from the session's advertised command
 * list, and passing it to the headless entry sends it to the model as prose
 * (measured: the turn ended `cancelled` after 13,420 input tokens). Declaring
 * an absent capability is a legal, documented state -- Usage & Limits shows an
 * honest row rather than an invented number -- and inventing headroom is the
 * one failure a quota display must not have.
 *
 * There is no search capability yet either. The vendor has a native
 * `web_search` tool, so a routed backend is expressible, but this route
 * currently denies web search outright as part of its isolation posture and a
 * search backend needs its own contract read before it is claimed.
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
})

/** Config after merge-and-validate: every field present, `executable` Grok-specific. */
interface ResolvedGrokConfig extends SharedProviderDefaults {
  readonly executable: string
  readonly contextWindowTokens: number
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

  const config: ResolvedGrokConfig = { ...shared, executable, contextWindowTokens }

  await registerProvider(ctx, grokDescriptor, config)
}

export { GrokCliAdapter, GROK_PRIMARY_PROVIDER } from './grok-primary.js'
