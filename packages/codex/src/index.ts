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
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type SubagentProvider,
  type SubagentRun,
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  apply as applyCodexPrimary,
  CODEX_APP_SERVER_PROVIDER,
  CodexAppServerAdapter,
} from './codex-plugin-dsh/index.js'
import {
  createCodexSubagentMemory,
  type ProjectMemoryServiceLike,
} from './memory.js'
import { resolveCodexExecutable } from './resolver.js'
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
    private readonly config: Required<Config>,
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

/** Register the Codex subagent and external Codex primary bridge. */
export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  const config: Required<Config> = {
    providerName: rawConfig.providerName ?? DEFAULT_PROVIDER_NAME,
    env: rawConfig.env ?? {},
    permissionMode: rawConfig.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
    disposeGraceMs: rawConfig.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
    modelCacheMs: rawConfig.modelCacheMs ?? 30_000,
    catalogTimeoutMs: rawConfig.catalogTimeoutMs ?? 10_000,
    turnTimeoutMs: rawConfig.turnTimeoutMs ?? 10 * 60_000,
    stderrMaxBytes: rawConfig.stderrMaxBytes ?? 16_384,
    modelPageSize: rawConfig.modelPageSize ?? 100,
  }

  if (config.providerName.trim().length === 0) {
    throw new Error('subagent-codex: providerName must be non-empty')
  }
  assertPositiveFinite('subagent-codex', 'disposeGraceMs', config.disposeGraceMs)
  if (config.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }

  ctx.subagents.registerProvider(new CodexProvider(config.providerName, ctx, config))
  await installCodexPrimaryHistoryBridge(ctx)
  applyCodexPrimary(ctx, {
    executable: externalCodexCommand(config.env),
    env: config.env,
    modelCacheMs: config.modelCacheMs,
    catalogTimeoutMs: config.catalogTimeoutMs,
    turnTimeoutMs: config.turnTimeoutMs,
    disposeGraceMs: config.disposeGraceMs,
    stderrMaxBytes: config.stderrMaxBytes,
    modelPageSize: config.modelPageSize,
  })
}

export { CODEX_APP_SERVER_PROVIDER, CodexAppServerAdapter, installCodexPrimaryHistoryBridge }
