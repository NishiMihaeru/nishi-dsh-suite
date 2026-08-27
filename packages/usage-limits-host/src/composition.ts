import type { Context } from '@deepseek-ai/cordis'
import {
  CLAUDE_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  ANTIGRAVITY_PROVIDER_ID,
  ClaudeUsageCollector,
  CodexUsageCollector,
  AntigravityUsageCollector,
  UsageLimitsService,
  UsageLimitsPublicFacade,
  type ClaudeUsageSource,
  type CodexRateLimitsSource,
  type AntigravityUsageCapabilitySource,
  type UsageProviderRegistration,
  type UsageRefreshPolicy,
  type UsageClock,
} from 'nishi-dsh-usage-limits'
import { HostAntigravityLocalUsageSource } from './antigravity-local-source.js'
import {
  OfficialClaudeUsageSource,
  DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
} from 'nishi-dsh-claude-usage-source'
import {
  OfficialCodexRateLimitsSource,
  DEFAULT_REQUEST_TIMEOUT_MS as DEFAULT_CODEX_REQUEST_TIMEOUT_MS,
} from 'nishi-dsh-codex-usage-source'

export const DEFAULT_USAGE_REFRESH_POLICY: UsageRefreshPolicy = Object.freeze({
  minRefreshIntervalMs: 60_000,
  staleAfterMs: 300_000,
})

export interface UsageLimitsHostDependencies {
  clock?: UsageClock
  claudeSource?: ClaudeUsageSource
  codexSource?: CodexRateLimitsSource
  antigravitySource?: AntigravityUsageCapabilitySource
  cwd?: string
}

export interface UsageLimitsHostConfig extends UsageLimitsHostDependencies {
  refreshPolicies?: {
    claude?: UsageRefreshPolicy
    codex?: UsageRefreshPolicy
    antigravity?: UsageRefreshPolicy
  }
}

export class HostClaudeUsageSource implements ClaudeUsageSource {
  constructor(
    private readonly ctx: Context,
    private readonly cwd: string = process.cwd(),
    private readonly requestTimeoutMs: number = DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  ) {}

  async read(): Promise<unknown> {
    const source = new OfficialClaudeUsageSource({
      cwd: this.cwd,
      requestTimeoutMs: this.requestTimeoutMs,
      spawn: (spec) => this.ctx.subprocess.spawn(spec),
    })
    return source.read()
  }
}

export class HostCodexRateLimitsSource implements CodexRateLimitsSource {
  constructor(
    private readonly ctx: Context,
    private readonly onRateLimitsUpdated?: () => void,
    private readonly cwd: string = process.cwd(),
    private readonly requestTimeoutMs: number = DEFAULT_CODEX_REQUEST_TIMEOUT_MS,
  ) {}

  async read(): Promise<unknown> {
    const source = new OfficialCodexRateLimitsSource({
      cwd: this.cwd,
      requestTimeoutMs: this.requestTimeoutMs,
      spawn: (spec) => this.ctx.subprocess.spawn(spec),
      onRateLimitsUpdated: this.onRateLimitsUpdated,
    })
    return source.read()
  }
}

export interface ComposedUsageHost {
  service: UsageLimitsService
  facade: UsageLimitsPublicFacade
}

export function composeUsageLimitsHost(
  ctx: Context,
  invalidationTarget: { invalidateProvider: (id: string) => void },
  config?: UsageLimitsHostConfig,
  clock: UsageClock = () => Date.now(),
): ComposedUsageHost {
  const cwd = config?.cwd ?? process.cwd()
  const claudeSource = config?.claudeSource ?? new HostClaudeUsageSource(ctx, cwd)
  const codexSource = config?.codexSource ?? new HostCodexRateLimitsSource(
    ctx,
    () => {
      try { invalidationTarget.invalidateProvider(CODEX_PROVIDER_ID) } catch {}
    },
    cwd,
  )
  const antigravitySource = config?.antigravitySource ?? new HostAntigravityLocalUsageSource()

  const descriptors: readonly {
    providerId: string
    collector: UsageProviderRegistration['collector']
    policy?: UsageRefreshPolicy
  }[] = [
    { providerId: CLAUDE_PROVIDER_ID, collector: new ClaudeUsageCollector(claudeSource), policy: config?.refreshPolicies?.claude },
    { providerId: CODEX_PROVIDER_ID, collector: new CodexUsageCollector(codexSource), policy: config?.refreshPolicies?.codex },
    { providerId: ANTIGRAVITY_PROVIDER_ID, collector: new AntigravityUsageCollector(antigravitySource), policy: config?.refreshPolicies?.antigravity },
  ]
  const registrations: UsageProviderRegistration[] = descriptors.map((descriptor) => ({
    providerId: descriptor.providerId,
    collector: descriptor.collector,
    policy: descriptor.policy ?? DEFAULT_USAGE_REFRESH_POLICY,
  }))

  const service = new UsageLimitsService(registrations, clock)
  const facade = new UsageLimitsPublicFacade(service, clock)
  return { service, facade }
}
