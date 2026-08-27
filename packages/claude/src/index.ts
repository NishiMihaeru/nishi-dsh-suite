/**
 * Claude as a provider plugin: usage and limits, and nothing else.
 *
 * This package is the honest test of the connector. Claude serves no model
 * route here — DSH talks to Claude through no adapter of ours — and offers no
 * search backend. It declares one capability, and the core neither notices
 * the absence of the others nor needs a branch for them. If a single-capability
 * provider needed anything beyond a descriptor, the contract would be wrong.
 *
 * Delegation to the Claude Code CLI was removed in `0.1.0-rc.2`; what remains
 * is a read-only usage source through the installed official `claude` CLI.
 *
 * @module nishi-dsh-claude
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
import { ClaudeUsageCollector } from './usage.js'
import { DEFAULT_USAGE_REQUEST_TIMEOUT_MS, OfficialClaudeUsageSource } from './usage-source.js'

export const name = 'claude'
export const inject = ['nishiProviders', 'subprocess']

export const DEFAULT_CLAUDE_EXECUTABLE = 'claude'
export const CLAUDE_EXECUTABLE_ENV = 'DSH_CLAUDE_EXECUTABLE'

/** Identity and lookup facts for the official Claude CLI. */
const CLAUDE_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'claude',
  defaultName: DEFAULT_CLAUDE_EXECUTABLE,
  envOverride: CLAUDE_EXECUTABLE_ENV,
  productName: 'Claude Code CLI',
}

/**
 * Only the shared fields matter here: there is no turn to time out and no
 * model catalog to cache, but the timers still bound the one usage request
 * and the stderr a failure may retain.
 */
const DEFAULT_CLAUDE_SHARED_CONFIG: SharedProviderDefaults = {
  env: {},
  modelCacheMs: 0,
  catalogTimeoutMs: DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  turnTimeoutMs: DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
}

export interface Config {
  env?: Record<string, string>
  usageRequestTimeoutMs?: number
  disposeGraceMs?: number
  stderrMaxBytes?: number
}

export const Config: Schema<Config> = Schema.object({
  env: Schema.dict(Schema.string()).default({}),
  usageRequestTimeoutMs: Schema.number().default(DEFAULT_USAGE_REQUEST_TIMEOUT_MS),
  disposeGraceMs: Schema.number().default(3_000),
  stderrMaxBytes: Schema.number().default(16_384),
})

interface ResolvedClaudeConfig extends SharedProviderDefaults {
  readonly usageRequestTimeoutMs: number
}

const claudeDescriptor: ProviderDescriptor<ResolvedClaudeConfig> = {
  id: 'claude',
  executable: CLAUDE_DESCRIPTOR,
  usage: {
    /**
     * One short-lived stream-json control session against the installed
     * `claude` CLI that issues exactly one `get_usage` request — no model
     * turn, no tools, no MCP servers, and no credential handling: sign-in
     * stays inside the vendor's own product boundary.
     */
    create: (ctx, config) => new ClaudeUsageCollector({
      read: () => new OfficialClaudeUsageSource({
        cwd: process.cwd(),
        env: config.env,
        requestTimeoutMs: config.usageRequestTimeoutMs,
        disposeGraceMs: config.disposeGraceMs,
        spawn: (spec) => ctx.subprocess.spawn(spec),
      }).read(),
    }),
  },
}

export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const usageRequestTimeoutMs = rawConfig.usageRequestTimeoutMs ?? DEFAULT_USAGE_REQUEST_TIMEOUT_MS
  const shared = resolveSharedProviderConfig('claude', {
    ...rawConfig,
    catalogTimeoutMs: usageRequestTimeoutMs,
    turnTimeoutMs: usageRequestTimeoutMs,
  }, DEFAULT_CLAUDE_SHARED_CONFIG)

  await registerProvider(ctx, claudeDescriptor, { ...shared, usageRequestTimeoutMs })
}

export { ClaudeUsageCollector } from './usage.js'
export { OfficialClaudeUsageSource, claudeUsageCliArgv } from './usage-source.js'
