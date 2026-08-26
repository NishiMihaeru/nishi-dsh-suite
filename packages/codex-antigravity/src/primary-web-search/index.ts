import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { createPrimarySearchBackends } from './providers.js'
import { applyPrimaryWebSearchTool, WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from './tool.js'

export const name = 'primary-web-search'
export const inject = ['tools', 'systemPrompt', 'subprocess']

const DEFAULT_SEARCH_TIMEOUT_MS = 60_000
const DEFAULT_ANTIGRAVITY_EXECUTABLE = 'agy'
const DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS = 2_000
const DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES = 64_000

export interface Config {
  searchMaxResults?: number
  searchMaxQueries?: number
  searchTimeoutMs?: number
  antigravityExecutable?: string
  antigravityEnv?: Record<string, string>
  antigravityDisposeGraceMs?: number
  antigravityStderrMaxBytes?: number
}

export const Config: Schema<Config> = Schema.object({
  searchMaxResults: Schema.number().default(WEB_SEARCH_MAX_RESULTS),
  searchMaxQueries: Schema.number().default(WEB_SEARCH_MAX_QUERIES),
  searchTimeoutMs: Schema.number().default(DEFAULT_SEARCH_TIMEOUT_MS),
  antigravityExecutable: Schema.string().default(DEFAULT_ANTIGRAVITY_EXECUTABLE),
  antigravityEnv: Schema.dict(Schema.string()).default({}),
  antigravityDisposeGraceMs: Schema.number().default(DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS),
  antigravityStderrMaxBytes: Schema.number().default(DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES),
})

function positiveInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`primary-web-search: ${label} must be a positive integer`)
  }
  return value
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const maxResults = positiveInteger('searchMaxResults', rawConfig.searchMaxResults ?? WEB_SEARCH_MAX_RESULTS)
  const maxQueries = positiveInteger('searchMaxQueries', rawConfig.searchMaxQueries ?? WEB_SEARCH_MAX_QUERIES)
  const timeoutMs = positiveInteger('searchTimeoutMs', rawConfig.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS)
  const disposeGraceMs = positiveInteger(
    'antigravityDisposeGraceMs',
    rawConfig.antigravityDisposeGraceMs ?? DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS,
  )
  const stderrMaxBytes = positiveInteger(
    'antigravityStderrMaxBytes',
    rawConfig.antigravityStderrMaxBytes ?? DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES,
  )

  const backends = createPrimarySearchBackends(ctx, {
    antigravity: {
      executable: rawConfig.antigravityExecutable ?? DEFAULT_ANTIGRAVITY_EXECUTABLE,
      env: rawConfig.antigravityEnv ?? {},
      timeoutMs,
      disposeGraceMs,
      stderrMaxBytes,
    },
  })
  applyPrimaryWebSearchTool(ctx, { maxResults, maxQueries, timeoutMs, backends })
}

export * from './errors.js'
export * from './route.js'
export * from './types.js'
export * from './tool.js'
