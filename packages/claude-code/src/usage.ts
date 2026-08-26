/**
 * Official Claude Agent SDK usage source for dsh-plugin.
 * Spawns an unattended CLI query with empty prompt and retrieves session cost.
 *
 * @module dsh-subagent-claude-code-custom/usage
 */

import {
  query as officialQuery,
  type Options,
  type Query,
  type SDKMessage,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
} from './process.js'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  disposeClaudeCodeChild,
} from './run.js'

export const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 30_000

export interface OfficialClaudeUsageSourceSpec {
  readonly cwd: string
  readonly executable: string
  readonly env?: Record<string, string>
  readonly requestTimeoutMs?: number
  readonly disposeGraceMs?: number
  readonly spawn?: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

export type ClaudeUsageQuery = Query & {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<unknown>
}

export interface OfficialClaudeUsageSourceDeps {
  readonly query?: (params: { prompt: AsyncIterable<SDKMessage>; options: Options }) => ClaudeUsageQuery
}

function emptyPrompt(): AsyncIterable<SDKMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      // 0 user turns: prompt iterator completes immediately
    },
  }
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function extractDisposeError(error: unknown): Error {
  const thrownErr = thrown(error)
  return (thrownErr as any).cause instanceof Error ? (thrownErr as any).cause : thrownErr
}

export class OfficialClaudeUsageSource {
  private readonly spec: OfficialClaudeUsageSourceSpec
  private readonly queryFactory: (params: {
    prompt: AsyncIterable<SDKMessage>
    options: Options
  }) => ClaudeUsageQuery

  constructor(spec: OfficialClaudeUsageSourceSpec, deps?: OfficialClaudeUsageSourceDeps) {
    if (spec.requestTimeoutMs !== undefined) {
      if (
        !Number.isSafeInteger(spec.requestTimeoutMs) ||
        spec.requestTimeoutMs <= 0 ||
        spec.requestTimeoutMs > MAX_TIMER_DELAY_MS
      ) {
        throw new Error(
          `subagent-claude-code: requestTimeoutMs must be a positive finite integer <= ${MAX_TIMER_DELAY_MS}`,
        )
      }
    }
    if (spec.disposeGraceMs !== undefined) {
      if (
        !Number.isSafeInteger(spec.disposeGraceMs) ||
        spec.disposeGraceMs <= 0 ||
        spec.disposeGraceMs > MAX_TIMER_DELAY_MS
      ) {
        throw new Error(
          `subagent-claude-code: disposeGraceMs must be a positive finite integer <= ${MAX_TIMER_DELAY_MS}`,
        )
      }
    }
    this.spec = spec
    this.queryFactory = deps?.query ?? (officialQuery as any)
  }

  async getUsage(): Promise<unknown> {
    const controller = new AbortController()
    let child: SubprocessHandle | undefined

    const timeoutMs = this.spec.requestTimeoutMs ?? DEFAULT_USAGE_REQUEST_TIMEOUT_MS
    const graceMs = this.spec.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
    const options: Options = {
      abortController: controller,
      cwd: this.spec.cwd,
      pathToClaudeCodeExecutable: this.spec.executable,
      env: {
        ...scrubbedParentEnv(),
        ...this.spec.env,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      },
      persistSession: false,
      disallowedTools: ['AskUserQuestion'],
      settingSources: [],
      spawnClaudeCodeProcess: (spawnOptions: SpawnOptions) => {
        const spawned = this.spec.spawn
          ? this.spec.spawn(claudeSpawnSpec(spawnOptions, graceMs))
          : undefined
        if (spawned) {
          child = spawned
          return new ManagedClaudeCodeProcess(spawned) as any
        }
        throw new Error('subagent-claude-code: spawn function not provided')
      },
    }

    let query: ClaudeUsageQuery | undefined

    try {
      query = this.queryFactory({
        prompt: emptyPrompt(),
        options,
      })

      if (child === undefined || child.pid <= 0) {
        throw new Error(
          'subagent-claude-code: official SDK did not publish a controllable Claude Code process',
        )
      }
    } catch (startupError: unknown) {
      if (child !== undefined) {
        try {
          await disposeClaudeCodeChild(query, child)
        } catch (disposeError: unknown) {
          throw new AggregateError(
            [thrown(startupError), extractDisposeError(disposeError)],
            'subagent-claude-code: startup failed and CLI cleanup also failed',
          )
        }
      } else if (query !== undefined) {
        try {
          query.close()
        } catch (disposeError: unknown) {
          throw new AggregateError(
            [thrown(startupError), extractDisposeError(disposeError)],
            'subagent-claude-code: startup failed and query cleanup also failed',
          )
        }
      }
      throw thrown(startupError)
    }

    let rawUsage: unknown
    let usageError: unknown
    let timer: NodeJS.Timeout | undefined

    try {
      const usagePromise = query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
      void usagePromise.catch(() => {})

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error('subagent-claude-code: usage request timed out')
          if (!controller.signal.aborted) {
            controller.abort(timeoutErr)
          }
          reject(timeoutErr)
        }, timeoutMs)
        timer.unref?.()
      })

      rawUsage = await Promise.race([usagePromise, timeoutPromise])
    } catch (error: unknown) {
      usageError = error
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      try {
        await disposeClaudeCodeChild(query, child)
      } catch (disposeError: unknown) {
        const cleanupError = extractDisposeError(disposeError)
        if (usageError !== undefined) {
          throw new AggregateError(
            [thrown(usageError), cleanupError],
            'subagent-claude-code: usage request failed and CLI cleanup also failed',
          )
        }
        throw cleanupError
      }
    }

    if (usageError !== undefined) {
      throw thrown(usageError)
    }

    return rawUsage
  }
}
