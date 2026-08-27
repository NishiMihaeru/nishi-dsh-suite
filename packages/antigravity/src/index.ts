import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type SubagentProvider,
  type SubagentRun,
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import {
  registerProvider,
  resolveSharedProviderConfig,
  type ProviderDescriptor,
  type SharedProviderDefaults,
  type VendorExecutableDescriptor,
} from 'nishi-dsh-provider-kit'
import { ANTIGRAVITY_PRIMARY_PROVIDER, createAntigravityPrimaryAdapter } from './antigravity-primary.js'
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
export const DEFAULT_ANTIGRAVITY_EXECUTABLE_ENV = 'DSH_ANTIGRAVITY_CLI_EXECUTABLE'
export const DEFAULT_ANTIGRAVITY_MODEL_CACHE_MS = 30_000
export const DEFAULT_ANTIGRAVITY_CATALOG_TIMEOUT_MS = 30_000
export const DEFAULT_ANTIGRAVITY_TURN_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_ANTIGRAVITY_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_ANTIGRAVITY_STDERR_MAX_BYTES = 64_000
export const DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME = 'antigravity'

/** Identity and lookup facts for the Antigravity CLI executable. */
const ANTIGRAVITY_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'subagent-antigravity',
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

/** Config after merge-and-validate: every field is present, the rest are Antigravity-specific. */
interface ResolvedAntigravityConfig extends SharedProviderDefaults {
  readonly executable: string
  readonly subagentProviderName: string
  readonly subagentModel: string
  readonly subagentEffort: 'low' | 'medium' | 'high'
}

class AntigravityProvider implements SubagentProvider {
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedAntigravityConfig,
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
      model: this.config.subagentModel,
      effort: this.config.subagentEffort,
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

/**
 * The Antigravity registration recipe: a subagent provider plus the
 * `AntigravityCliAdapter` as the `antigravity-cli` model route.
 *
 * Unlike Codex, the adapter here has a clean `create(): LlmAdapter` — it is
 * just `new AntigravityCliAdapter(ctx, config)` — so `model` is populated
 * directly instead of falling back to `install`. The adapter's dispose
 * effect is bound inside `createAntigravityPrimaryAdapter`, which the live
 * suite drives directly so it exercises the same object production does.
 */
const antigravityDescriptor: ProviderDescriptor<ResolvedAntigravityConfig> = {
  id: 'subagent-antigravity',
  executable: ANTIGRAVITY_DESCRIPTOR,
  subagent: {
    create: (ctx, config) => new AntigravityProvider(config.subagentProviderName, ctx, config),
  },
  model: {
    routes: [ANTIGRAVITY_PRIMARY_PROVIDER],
    create: (ctx, config) => createAntigravityPrimaryAdapter(ctx, config),
  },
}

export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const executable = rawConfig.executable ?? DEFAULT_ANTIGRAVITY_EXECUTABLE
  if (executable.trim().length === 0) throw new Error('subagent-antigravity: executable must be non-empty')
  const subagentProviderName = rawConfig.subagentProviderName ?? DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME
  if (subagentProviderName.trim().length === 0) throw new Error('subagent-antigravity: subagentProviderName must be non-empty')
  const subagentModel = rawConfig.subagentModel ?? DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL
  if (subagentModel.trim().length === 0) throw new Error('subagent-antigravity: subagentModel must be non-empty')

  const shared = resolveSharedProviderConfig('subagent-antigravity', rawConfig, DEFAULT_ANTIGRAVITY_SHARED_CONFIG)

  const config: ResolvedAntigravityConfig = {
    ...shared,
    executable,
    subagentProviderName,
    subagentModel,
    subagentEffort: rawConfig.subagentEffort ?? DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT,
  }

  await registerProvider(ctx, antigravityDescriptor, config)
}
