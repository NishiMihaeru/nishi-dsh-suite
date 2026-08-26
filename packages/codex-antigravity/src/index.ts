/**
 * Managed provider bridge for Codex plus Antigravity primary/subagent routes that
 * stay behind official vendor-owned local runtimes.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-codex/src/index.ts
 *
 * @module dsh-subagent-codex-custom
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type SubagentProvider,
  type SubagentRun,
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  createCodexSubagentMemory,
  type ProjectMemoryServiceLike,
} from './memory.js'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexStartupFailure,
  startCodexRun,
  type CodexPermissionMode,
} from './run.js'
import { installCodexPrimaryHistoryBridge } from './primary-history.js'
import { installAntigravityPrimaryAdapter } from './antigravity-primary.js'
import {
  DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT,
  DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL,
  startAntigravitySubagentRun,
} from './antigravity-subagent.js'

export const name = 'subagent-codex'
export const inject = ['subagents', 'subprocess', 'llm', 'projectMemory']

const DEFAULT_PROVIDER_NAME = 'codex'
const DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME = 'antigravity'
const DEFAULT_ANTIGRAVITY_EXECUTABLE = 'agy'
const DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS = 30_000
const DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS = 30_000
const DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS = 10 * 60_000
const DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES = 64_000

export interface Config {
  providerName?: string
  env?: Record<string, string>
  permissionMode?: CodexPermissionMode
  disposeGraceMs?: number
  antigravityExecutable?: string
  antigravityEnv?: Record<string, string>
  antigravityModelCacheMs?: number
  antigravityCatalogTimeoutMs?: number
  antigravityTurnTimeoutMs?: number
  antigravityStderrMaxBytes?: number
  antigravitySubagentProviderName?: string
  antigravitySubagentModel?: string
  antigravitySubagentEffort?: 'low' | 'medium' | 'high'
}

export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default(DEFAULT_PROVIDER_NAME),
  env: Schema.dict(Schema.string()).default({}),
  permissionMode: Schema.union([...CODEX_PERMISSION_MODES]).default(DEFAULT_CODEX_PERMISSION_MODE),
  disposeGraceMs: Schema.number().default(DEFAULT_DISPOSE_GRACE_MS),
  antigravityExecutable: Schema.string().default(DEFAULT_ANTIGRAVITY_EXECUTABLE),
  antigravityEnv: Schema.dict(Schema.string()).default({}),
  antigravityModelCacheMs: Schema.number().default(DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS),
  antigravityCatalogTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS),
  antigravityTurnTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS),
  antigravityStderrMaxBytes: Schema.number().default(DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES),
  antigravitySubagentProviderName: Schema.string().default(DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME),
  antigravitySubagentModel: Schema.string().default(DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL),
  antigravitySubagentEffort: Schema.union(['low', 'medium', 'high'] as const).default(
    DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT,
  ),
})

class CodexProvider implements SubagentProvider {
  readonly name: string
  readonly ctx: Context
  readonly config: Required<Pick<Config, 'providerName' | 'env' | 'permissionMode' | 'disposeGraceMs'>>
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    name: string,
    ctx: Context,
    config: Required<Pick<Config, 'providerName' | 'env' | 'permissionMode' | 'disposeGraceMs'>>,
  ) {
    this.name = name
    this.ctx = ctx
    this.config = config
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-codex: no working directory for the child — delegate from a parent session that has one',
      )
    }
    let cwd: string
    try {
      cwd = resolveChildCwd('subagent-codex', undefined, parentCwd)
    } catch (error) {
      if (request.signal.aborted) {
        throw new Error('subagent-codex: request was aborted before app-server startup')
      }
      throw codexStartupFailure(error)
    }
    const projectMemory = await createCodexSubagentMemory(
      (this.ctx as any).projectMemory as ProjectMemoryServiceLike,
      cwd,
      request.signal,
    )
    return startCodexRun(request, {
      cwd,
      permissionMode: this.config.permissionMode,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      projectMemory,
      spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-codex "${this.name}": child run failed (${stopReason}): ${error.message}`,
        )
      },
    })
  }
}

interface AntigravityProviderConfig {
  readonly providerName: string
  readonly executable: string
  readonly env: Record<string, string>
  readonly model: string
  readonly effort: 'low' | 'medium' | 'high'
  readonly turnTimeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
}

class AntigravityProvider implements SubagentProvider {
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: AntigravityProviderConfig,
  ) {}

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-antigravity: no working directory for the child — delegate from a parent session that has one',
      )
    }
    const cwd = resolveChildCwd('subagent-antigravity', undefined, parentCwd)
    const projectMemory = await createCodexSubagentMemory(
      (this.ctx as any).projectMemory as ProjectMemoryServiceLike,
      cwd,
      request.signal,
    )
    return startAntigravitySubagentRun(request, {
      cwd,
      executable: this.config.executable,
      env: this.config.env,
      model: this.config.model,
      effort: this.config.effort,
      turnTimeoutMs: this.config.turnTimeoutMs,
      disposeGraceMs: this.config.disposeGraceMs,
      stderrMaxBytes: this.config.stderrMaxBytes,
      projectMemory,
      resolveExecutable: (executable, env, signal) =>
        this.ctx.subprocess.resolveExecutable(executable, env, signal),
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-antigravity "${this.name}": child run failed (${stopReason}): ${error.message}`,
        )
      },
    })
  }
}

/** Register managed Codex/Antigravity subagents plus Codex/Antigravity primary bridges. */
export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const codexConfig: Required<Pick<Config, 'providerName' | 'env' | 'permissionMode' | 'disposeGraceMs'>> = {
    providerName: rawConfig.providerName ?? DEFAULT_PROVIDER_NAME,
    env: rawConfig.env ?? {},
    permissionMode: rawConfig.permissionMode ?? 'never',
    disposeGraceMs: rawConfig.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
  }

  const antigravityConfig = {
    executable: rawConfig.antigravityExecutable ?? DEFAULT_ANTIGRAVITY_EXECUTABLE,
    env: rawConfig.antigravityEnv ?? {},
    modelCacheMs: rawConfig.antigravityModelCacheMs ?? DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS,
    catalogTimeoutMs: rawConfig.antigravityCatalogTimeoutMs ?? DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS,
    turnTimeoutMs: rawConfig.antigravityTurnTimeoutMs ?? DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS,
    disposeGraceMs: codexConfig.disposeGraceMs,
    stderrMaxBytes: rawConfig.antigravityStderrMaxBytes ?? DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES,
  }

  const antigravitySubagentConfig: AntigravityProviderConfig = {
    providerName: rawConfig.antigravitySubagentProviderName ?? DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME,
    executable: antigravityConfig.executable,
    env: antigravityConfig.env,
    model: rawConfig.antigravitySubagentModel ?? DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL,
    effort: rawConfig.antigravitySubagentEffort ?? DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT,
    turnTimeoutMs: antigravityConfig.turnTimeoutMs,
    disposeGraceMs: antigravityConfig.disposeGraceMs,
    stderrMaxBytes: antigravityConfig.stderrMaxBytes,
  }

  assertPositiveFinite('subagent-codex', 'disposeGraceMs', codexConfig.disposeGraceMs)
  if (codexConfig.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (antigravityConfig.executable.trim().length === 0) {
    throw new Error('subagent-codex: antigravityExecutable must be non-empty')
  }
  if (antigravitySubagentConfig.providerName.trim().length === 0) {
    throw new Error('subagent-codex: antigravitySubagentProviderName must be non-empty')
  }
  if (antigravitySubagentConfig.model.trim().length === 0) {
    throw new Error('subagent-codex: antigravitySubagentModel must be non-empty')
  }
  if (!Number.isFinite(antigravityConfig.modelCacheMs) || antigravityConfig.modelCacheMs < 0) {
    throw new Error('subagent-codex: antigravityModelCacheMs must be non-negative and finite')
  }
  for (const [field, value] of [
    ['antigravityCatalogTimeoutMs', antigravityConfig.catalogTimeoutMs],
    ['antigravityTurnTimeoutMs', antigravityConfig.turnTimeoutMs],
    ['antigravityStderrMaxBytes', antigravityConfig.stderrMaxBytes],
  ] as const) {
    assertPositiveFinite('subagent-codex', field, value)
    if (value > MAX_TIMER_DELAY_MS && field !== 'antigravityStderrMaxBytes') {
      throw new Error(`subagent-codex: ${field} must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
  }

  ctx.subagents.registerProvider(new CodexProvider(codexConfig.providerName, ctx, codexConfig))
  ctx.subagents.registerProvider(new AntigravityProvider(
    antigravitySubagentConfig.providerName,
    ctx,
    antigravitySubagentConfig,
  ))
  await installCodexPrimaryHistoryBridge(ctx)
  installAntigravityPrimaryAdapter(ctx, antigravityConfig)
}
