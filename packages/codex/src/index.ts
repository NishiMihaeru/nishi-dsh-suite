/**
 * Codex primary provider plugin: the external Codex App Server bridge.
 *
 * Delegation was removed in `0.1.0-rc.3` — this package no longer contributes
 * a subagent provider, and the vendor's own child-agent runner, wire protocol
 * and subagent memory transport were deleted with it. Only the primary plane
 * remains, so a Codex turn goes through the same DSH tools, project memory and
 * usage surface as every other provider's.
 *
 * @module nishi-dsh-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import {
  registerProvider,
  resolveSharedProviderConfig,
  type ProviderDescriptor,
  type SharedProviderDefaults,
} from 'nishi-dsh-core/runtime'
import {
  createAdapter as createCodexPrimaryAdapter,
  CODEX_APP_SERVER_PROVIDER,
  CodexAppServerAdapter,
} from './codex-plugin-dsh/index.js'
import { CODEX_DESCRIPTOR } from './resolver.js'
import { installCodexPrimaryHistoryBridge } from './primary-history.js'

export const name = 'codex'
export const inject = [
  'nishiProviders',
  'subprocess',
  'llm',
  'sessions',
  'attachments',
]

/** Grace between managed subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3000

/** Fields shared by every subscription-CLI provider, defaulted for Codex. */
const DEFAULT_CODEX_SHARED_CONFIG: SharedProviderDefaults = {
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 10 * 60_000,
  disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
  stderrMaxBytes: 16_384,
}

export interface Config {
  env?: Record<string, string>
  disposeGraceMs?: number
  modelCacheMs?: number
  catalogTimeoutMs?: number
  turnTimeoutMs?: number
  stderrMaxBytes?: number
  modelPageSize?: number
}

export const Config: Schema<Config> = Schema.object({
  env: Schema.dict(Schema.string()).default({}),
  disposeGraceMs: Schema.number().default(DEFAULT_DISPOSE_GRACE_MS),
  modelCacheMs: Schema.number().default(30_000),
  catalogTimeoutMs: Schema.number().default(10_000),
  turnTimeoutMs: Schema.number().default(10 * 60_000),
  stderrMaxBytes: Schema.number().default(16_384),
  modelPageSize: Schema.number().default(100),
})

/** Config after merge-and-validate: every field is present, `modelPageSize` is Codex-specific. */
interface ResolvedCodexConfig extends SharedProviderDefaults {
  readonly modelPageSize: number
}

function externalCodexCommand(env: Record<string, string>): string {
  const override = env.DSH_CODEX_EXECUTABLE?.trim() || process.env.DSH_CODEX_EXECUTABLE?.trim()
  return override && override.length > 0 ? override : 'codex'
}

/**
 * The Codex registration recipe: the external Codex App Server primary
 * bridge, and nothing else.
 *
 * `model.create` builds the vendored `CodexAppServerAdapter` through
 * `createAdapter`, which binds the session and dispose lifecycles but
 * deliberately does not register the route — every provider reaches
 * `ctx.llm` through the single registration path. `install` then adds the
 * primary history bridge, which assumes the adapter already exists.
 */
const codexDescriptor: ProviderDescriptor<ResolvedCodexConfig> = {
  id: 'codex',
  executable: CODEX_DESCRIPTOR,
  model: {
    routes: [CODEX_APP_SERVER_PROVIDER],
    create: (ctx, config) => createCodexPrimaryAdapter(ctx, {
      executable: externalCodexCommand(config.env),
      env: config.env,
      modelCacheMs: config.modelCacheMs,
      catalogTimeoutMs: config.catalogTimeoutMs,
      turnTimeoutMs: config.turnTimeoutMs,
      disposeGraceMs: config.disposeGraceMs,
      stderrMaxBytes: config.stderrMaxBytes,
      modelPageSize: config.modelPageSize,
    }),
  },
  async install(ctx) {
    await installCodexPrimaryHistoryBridge(ctx)
  },
}

/** Register the external Codex primary bridge. */
export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const shared = resolveSharedProviderConfig('codex', rawConfig, DEFAULT_CODEX_SHARED_CONFIG)
  const config: ResolvedCodexConfig = {
    ...shared,
    modelPageSize: rawConfig.modelPageSize ?? 100,
  }

  await registerProvider(ctx, codexDescriptor, config)
}

export { CODEX_APP_SERVER_PROVIDER, CodexAppServerAdapter, installCodexPrimaryHistoryBridge }
