/**
 * Codex subagent provider and external primary runtime bridge.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-codex/src/index.ts
 *
 * @module nishi-dsh-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
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
} from 'nishi-dsh-provider-kit'
import {
  createAdapter as createCodexPrimaryAdapter,
  CODEX_APP_SERVER_PROVIDER,
  CodexAppServerAdapter,
} from './codex-plugin-dsh/index.js'
import {
  createCodexSubagentMemory,
  type ProjectMemoryServiceLike,
} from './memory.js'
import { CODEX_DESCRIPTOR, resolveCodexExecutable } from './resolver.js'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexStartupFailure,
  startCodexRun,
  type CodexPermissionMode,
} from './run.js'
import { installCodexPrimaryHistoryBridge } from './primary-history.js'

export const name = 'subagent-codex'
export const inject = [
  'subagents',
  'subprocess',
  'llm',
  'projectMemory',
  'sessions',
  'attachments',
]

const DEFAULT_PROVIDER_NAME = 'codex'

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
  providerName?: string
  env?: Record<string, string>
  permissionMode?: CodexPermissionMode
  disposeGraceMs?: number
  modelCacheMs?: number
  catalogTimeoutMs?: number
  turnTimeoutMs?: number
  stderrMaxBytes?: number
  modelPageSize?: number
}

export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default(DEFAULT_PROVIDER_NAME),
  env: Schema.dict(Schema.string()).default({}),
  permissionMode: Schema.union([...CODEX_PERMISSION_MODES]).default(DEFAULT_CODEX_PERMISSION_MODE),
  disposeGraceMs: Schema.number().default(DEFAULT_DISPOSE_GRACE_MS),
  modelCacheMs: Schema.number().default(30_000),
  catalogTimeoutMs: Schema.number().default(10_000),
  turnTimeoutMs: Schema.number().default(10 * 60_000),
  stderrMaxBytes: Schema.number().default(16_384),
  modelPageSize: Schema.number().default(100),
})

/** Config after merge-and-validate: every field is present, `providerName`/`permissionMode`/`modelPageSize` are Codex-specific. */
interface ResolvedCodexConfig extends SharedProviderDefaults {
  readonly providerName: string
  readonly permissionMode: CodexPermissionMode
  readonly modelPageSize: number
}

function externalCodexCommand(env: Record<string, string>): string {
  const override = env.DSH_CODEX_EXECUTABLE?.trim() || process.env.DSH_CODEX_EXECUTABLE?.trim()
  return override && override.length > 0 ? override : 'codex'
}

class CodexProvider implements SubagentProvider {
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedCodexConfig,
  ) {}

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
    const executable = resolveCodexExecutable({
      env: { ...process.env, ...this.config.env },
    }).executable
    const projectMemory = await createCodexSubagentMemory(
      (this.ctx as any).projectMemory as ProjectMemoryServiceLike,
      cwd,
      request.signal,
    )
    return startCodexRun(request, {
      cwd,
      executable,
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

/**
 * The Codex registration recipe: a subagent provider plus an `install` step
 * for the external Codex App Server primary bridge.
 *
 * There is no `model` entry here. `applyCodexPrimary` (in
 * `./codex-plugin-dsh/index.ts`, vendored from upstream `codex-plugin-dsh`)
 * builds and registers its `CodexAppServerAdapter` in one motion, together
 * with model-catalog caching, a `session/event` listener, and its own
 * dispose effect — extracting a standalone `create(): LlmAdapter` out of
 * that would mean rewriting `adapter.ts`, which is out of scope here. So
 * Codex's whole primary bridge — history installation and
 * `applyCodexPrimary` together — runs as `install`, exactly as `apply()`
 * ran them before this module existed.
 */
const codexDescriptor: ProviderDescriptor<ResolvedCodexConfig> = {
  id: 'subagent-codex',
  executable: CODEX_DESCRIPTOR,
  subagent: {
    create: (ctx, config) => new CodexProvider(config.providerName, ctx, config),
  },
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

/** Register the Codex subagent and external Codex primary bridge. */
export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const providerName = rawConfig.providerName ?? DEFAULT_PROVIDER_NAME
  if (providerName.trim().length === 0) {
    throw new Error('subagent-codex: providerName must be non-empty')
  }
  const shared = resolveSharedProviderConfig('subagent-codex', rawConfig, DEFAULT_CODEX_SHARED_CONFIG)
  const config: ResolvedCodexConfig = {
    ...shared,
    providerName,
    permissionMode: rawConfig.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
    modelPageSize: rawConfig.modelPageSize ?? 100,
  }

  await registerProvider(ctx, codexDescriptor, config)
}

export { CODEX_APP_SERVER_PROVIDER, CodexAppServerAdapter, installCodexPrimaryHistoryBridge }
