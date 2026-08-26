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
import { installAntigravityPrimaryAdapter } from './antigravity-primary.js'
import {
  DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT,
  DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL,
  startAntigravitySubagentRun,
} from './antigravity-subagent.js'
import {
  createAntigravitySubagentMemory,
  type ProjectMemoryServiceLike,
} from './memory.js'

export const name = 'subagent-antigravity'
export const inject = ['subagents', 'subprocess', 'llm', 'projectMemory']

export const DEFAULT_ANTIGRAVITY_EXECUTABLE = 'agy'
export const DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS = 30_000
export const DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS = 30_000
export const DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES = 64_000
export const DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME = 'antigravity'

export interface Config {
  executable?: string
  env?: Record<string, string>
  modelCacheMs?: number
  catalogTimeoutMs?: number
  turnTimeoutMs?: number
  disposeGraceMs?: number
  stderrMaxBytes?: number
  subagentProviderName?: string
  subagentModel?: string
  subagentEffort?: 'low' | 'medium' | 'high'
}

export const Config: Schema<Config> = Schema.object({
  executable: Schema.string().default(DEFAULT_ANTIGRAVITY_EXECUTABLE),
  env: Schema.dict(Schema.string()).default({}),
  modelCacheMs: Schema.number().default(DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS),
  catalogTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS),
  turnTimeoutMs: Schema.number().default(DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS),
  disposeGraceMs: Schema.number().default(DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS),
  stderrMaxBytes: Schema.number().default(DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES),
  subagentProviderName: Schema.string().default(DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME),
  subagentModel: Schema.string().default(DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL),
  subagentEffort: Schema.union(['low', 'medium', 'high'] as const).default(DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT),
})

interface AntigravityProviderConfig {
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
    const projectMemory = await createAntigravitySubagentMemory(
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

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config = {
    executable: rawConfig.executable ?? DEFAULT_ANTIGRAVITY_EXECUTABLE,
    env: rawConfig.env ?? {},
    modelCacheMs: rawConfig.modelCacheMs ?? DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS,
    catalogTimeoutMs: rawConfig.catalogTimeoutMs ?? DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS,
    turnTimeoutMs: rawConfig.turnTimeoutMs ?? DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS,
    disposeGraceMs: rawConfig.disposeGraceMs ?? DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS,
    stderrMaxBytes: rawConfig.stderrMaxBytes ?? DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES,
    subagentProviderName: rawConfig.subagentProviderName ?? DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME,
    subagentModel: rawConfig.subagentModel ?? DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL,
    subagentEffort: rawConfig.subagentEffort ?? DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT,
  }

  if (config.executable.trim().length === 0) throw new Error('subagent-antigravity: executable must be non-empty')
  if (config.subagentProviderName.trim().length === 0) throw new Error('subagent-antigravity: subagentProviderName must be non-empty')
  if (config.subagentModel.trim().length === 0) throw new Error('subagent-antigravity: subagentModel must be non-empty')
  if (!Number.isFinite(config.modelCacheMs) || config.modelCacheMs < 0) {
    throw new Error('subagent-antigravity: modelCacheMs must be non-negative and finite')
  }
  for (const [field, value] of [
    ['catalogTimeoutMs', config.catalogTimeoutMs],
    ['turnTimeoutMs', config.turnTimeoutMs],
    ['disposeGraceMs', config.disposeGraceMs],
    ['stderrMaxBytes', config.stderrMaxBytes],
  ] as const) {
    assertPositiveFinite('subagent-antigravity', field, value)
    if (field !== 'stderrMaxBytes' && value > MAX_TIMER_DELAY_MS) {
      throw new Error(`subagent-antigravity: ${field} must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
  }

  ctx.subagents.registerProvider(new AntigravityProvider(config.subagentProviderName, ctx, {
    executable: config.executable,
    env: config.env,
    model: config.subagentModel,
    effort: config.subagentEffort,
    turnTimeoutMs: config.turnTimeoutMs,
    disposeGraceMs: config.disposeGraceMs,
    stderrMaxBytes: config.stderrMaxBytes,
  }))

  installAntigravityPrimaryAdapter(ctx, {
    executable: config.executable,
    env: config.env,
    modelCacheMs: config.modelCacheMs,
    catalogTimeoutMs: config.catalogTimeoutMs,
    turnTimeoutMs: config.turnTimeoutMs,
    disposeGraceMs: config.disposeGraceMs,
    stderrMaxBytes: config.stderrMaxBytes,
  })
}
