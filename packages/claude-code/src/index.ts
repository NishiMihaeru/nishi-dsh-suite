/**
 * Profile-named Claude Code one-shot subagent provider. Every accepted run
 * invokes the installed official Claude CLI in the delegating Session's
 * workspace and places the real process tree under the shared subprocess owner.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-claude-code/src/index.ts
 *
 * @module dsh-subagent-claude-code-custom
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
  createClaudeSubagentMemory,
  type ProjectMemoryServiceLike,
} from './memory.js'
import {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  startClaudeCodeRun,
  type ClaudeCodePermissionMode,
} from './run.js'

export const name = 'subagent-claude-code'
export const inject = ['subagents', 'subprocess', 'projectMemory']

const DEFAULT_PROVIDER_NAME = 'claude-code'

export interface Config {
  providerName?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  permissionMode?: ClaudeCodePermissionMode
  env?: Record<string, string>
  disposeGraceMs?: number
}

export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default(DEFAULT_PROVIDER_NAME),
  model: Schema.string().default(DEFAULT_MODEL),
  effort: Schema.union(['low', 'medium', 'high'] as const).default(DEFAULT_EFFORT),
  permissionMode: Schema.union([...CLAUDE_CODE_PERMISSION_MODES]).default(
    DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  ),
  env: Schema.dict(Schema.string()).default({}),
  disposeGraceMs: Schema.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

class ClaudeCodeProvider implements SubagentProvider {
  readonly name: string
  readonly ctx: Context
  readonly config: Required<Config>
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(name: string, ctx: Context, config: Required<Config>) {
    this.name = name
    this.ctx = ctx
    this.config = config
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-claude-code: no working directory for the child — delegate from a parent session that has one',
      )
    }
    const cwd = resolveChildCwd('subagent-claude-code', undefined, parentCwd)
    const projectMemory = await createClaudeSubagentMemory(
      (this.ctx as any).projectMemory as ProjectMemoryServiceLike,
      cwd,
      request.signal,
    )
    return startClaudeCodeRun(request, {
      cwd,
      model: this.config.model,
      effort: this.config.effort,
      permissionMode: this.config.permissionMode,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      projectMemory,
      spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-claude-code "${this.name}": child run failed (${stopReason}): %o`,
          error,
        )
      },
    })
  }
}

/** Register one Profile-named Claude Code provider. */
export function apply(ctx: Context, rawConfig: Config = {}): void {
  const resolved: Required<Config> = {
    providerName: rawConfig.providerName ?? DEFAULT_PROVIDER_NAME,
    model: rawConfig.model ?? DEFAULT_MODEL,
    effort: rawConfig.effort ?? DEFAULT_EFFORT,
    permissionMode: rawConfig.permissionMode ?? DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
    env: rawConfig.env ?? {},
    disposeGraceMs: rawConfig.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
  }

  if (!['low', 'medium', 'high'].includes(resolved.effort)) {
    throw new Error('subagent-claude-code: effort must be one of low, medium, high')
  }
  if (!CLAUDE_CODE_PERMISSION_MODES.includes(resolved.permissionMode)) {
    throw new Error(
      `subagent-claude-code: permissionMode must be one of ${CLAUDE_CODE_PERMISSION_MODES.join(', ')}`,
    )
  }

  assertPositiveFinite('subagent-claude-code', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-claude-code: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }

  ctx.subagents.registerProvider(new ClaudeCodeProvider(resolved.providerName, ctx, resolved))
}
