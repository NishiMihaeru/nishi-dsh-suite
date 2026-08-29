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
import { CodexSearchBackend } from './web-search-backend.js'
import { CodexUsageCollector } from './usage.js'
import { DEFAULT_REQUEST_TIMEOUT_MS, OfficialCodexRateLimitsSource } from './usage-source.js'
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
  presentation: {
    id: 'codex',
    displayName: 'Codex',
    brandColor: '#10A37F',
    iconPath: 'M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128z',
  },
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
  webSearch: {
    create: (ctx, config) => new CodexSearchBackend(ctx, {
      executable: externalCodexCommand(config.env),
      env: config.env,
    }),
  },
  usage: {
    /**
     * A short-lived app-server session that reads rate limits and nothing
     * else: no thread, no prompt, no credential handling. Refresh cadence and
     * cache invalidation stay in Core; this connection is not the primary-turn
     * connection and therefore does not claim turn-driven usage notifications.
     */
    create: (ctx, config) => new CodexUsageCollector({
      read: () => new OfficialCodexRateLimitsSource({
        cwd: process.cwd(),
        executable: externalCodexCommand(config.env),
        env: config.env,
        requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        resolveExecutable: (command, env, signal) => ctx.subprocess.resolveExecutable(command, env, signal),
        spawn: (spec) => ctx.subprocess.spawn(spec),
      }).read(),
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
