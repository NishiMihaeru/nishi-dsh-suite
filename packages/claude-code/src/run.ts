/**
 * One-shot Claude Code lifecycle: invoke the official Agent SDK, place its
 * real CLI process under the shared subprocess owner, map only strict SDK
 * success to completion, and dispose to whole-tree quiescence.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-claude-code/src/run.ts
 *
 * Custom Policy Delta:
 * Injects model and effort into official SDK Options:
 * - default model: claude-sonnet-5
 * - default effort: high
 * - default permissionMode: auto
 *
 * @module dsh-subagent-claude-code-custom/run
 */

import { randomUUID } from 'node:crypto'
import {
  query,
  type Options,
  type Query,
  type SDKResultMessage,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  claudePromptWithProjectMemory,
  type ClaudeSubagentMemory,
} from './memory.js'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
} from './process.js'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3000

/** Claude Code permission modes that cannot wait for a human response. */
export const CLAUDE_CODE_PERMISSION_MODES = [
  'dontAsk',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
] as const

export type ClaudeCodePermissionMode = typeof CLAUDE_CODE_PERMISSION_MODES[number]

/** Safe default for unattended Claude Code runs in dsh-plugin. */
export const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = 'auto'

export const DEFAULT_MODEL = 'claude-sonnet-5'
export const DEFAULT_EFFORT: 'low' | 'medium' | 'high' = 'high'

export const SUPPORTED_UNATTENDED_DIALOG_KINDS = ['refusal_fallback_prompt'] as const

export interface ClaudeCodeFailureFacts {
  readonly stage: 'query-start' | 'query-run' | 'process' | 'teardown'
  readonly category: string
  readonly outcome?: SubprocessOutcome | undefined
}

function failureDiagnostic(facts: ClaudeCodeFailureFacts): string {
  const fields = ['product: Claude Code', `stage: ${facts.stage}`, `category: ${facts.category}`]
  const exitCode = facts.outcome?.exitCode
  if (exitCode !== null && exitCode !== undefined) fields.push(`exit code: ${exitCode}`)
  const signal = facts.outcome?.signal
  if (signal !== null && signal !== undefined) fields.push(`signal: ${signal}`)
  return `Product subagent failure (${fields.join('; ')})`
}

export class ClaudeCodeFailure extends Error {
  readonly facts: ClaudeCodeFailureFacts

  constructor(facts: ClaudeCodeFailureFacts, cause?: unknown) {
    super(
      `subagent-claude-code: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.facts = facts
    this.name = 'ClaudeCodeFailure'
  }
}

function sdkFailureCategory(subtype: string): string {
  switch (subtype) {
    case 'error_during_execution':
    case 'error_max_turns':
    case 'error_max_budget_usd':
    case 'error_max_structured_output_retries':
      return subtype
    default:
      return 'unknown'
  }
}

/**
 * Hide an unpublished product startup failure behind fixed safe facts.
 * @param cause - original host-side failure retained only on the Error cause chain.
 * @returns a rejection safe to expose through the subagent start boundary.
 */
export function claudeCodeStartupFailure(cause: unknown): ClaudeCodeFailure {
  return new ClaudeCodeFailure(
    {
      stage: 'query-start',
      category: 'unknown',
    },
    cause,
  )
}

function unattendedDiagnostic(
  mode: ClaudeCodePermissionMode,
  request: string,
  decision: string,
  reason: string,
): string {
  return `Claude Code unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Validate and preserve the one-shot task before crossing the SDK boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact text sequence as one SDK prompt.
 */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-claude-code: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-claude-code: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every((text) => text.trim().length === 0)) {
    throw new Error('subagent-claude-code: the one-shot task must not be empty')
  }
  return texts.join('')
}

/**
 * Strictly derive the only SDK result that can complete a shared run.
 * @param message - an official discriminated result union.
 * @returns exact final text for a successful, non-error result.
 */
export function successfulResult(message: SDKResultMessage): string {
  if (message.subtype !== 'success') {
    const category = sdkFailureCategory(message.subtype)
    const detail = category === 'unknown' ? undefined : (message as any).errors?.join('; ')
    throw new ClaudeCodeFailure(
      {
        stage: 'query-run',
        category,
      },
      detail === undefined || detail.length === 0 ? undefined : new Error(detail),
    )
  }
  if ((message as any).is_error || (message as any).result?.trim().length === 0) {
    throw new ClaudeCodeFailure({
      stage: 'query-run',
      category: 'invalid-success',
    })
  }
  return (message as any).result
}

/**
 * Consume the complete SDK stream and require one strict success plus normal
 * iterator completion.
 * @param queryHandle - published official SDK query.
 * @param onPermissionDenied - records a safe fact when the SDK reports native denial.
 * @param onResult - records that the SDK supplied a terminal result message.
 * @returns the completed shared result.
 */
export async function consumeClaudeQuery(
  queryHandle: AsyncIterable<any> | Query,
  onUsageInvalidated?: () => void,
  onPermissionDenied?: () => void,
  onResult?: () => void,
): Promise<{ output: ContentBlock[]; stopReason: SubagentStopReason }> {
  let answer: string | undefined
  for await (const message of queryHandle as any) {
    if (message.type === 'rate_limit_event') {
      try {
        onUsageInvalidated?.()
      } catch {}
      continue
    }
    if (message.type === 'system' && message.subtype === 'permission_denied') {
      onPermissionDenied?.()
      continue
    }
    if (message.type !== 'result') continue
    onResult?.()
    answer = successfulResult(message)
  }
  if (answer === undefined) {
    throw new ClaudeCodeFailure({
      stage: 'query-run',
      category: 'missing-result',
    })
  }
  return {
    output: [{ type: 'text', text: answer }],
    stopReason: 'completed',
  }
}

/**
 * Close the official query, terminate the managed process tree, and wait for
 * the subprocess owner to prove it is gone.
 * @param queryHandle - official SDK query, when creation reached that point.
 * @param child - live shared-service handle that owns the CLI process tree.
 */
export async function disposeClaudeCodeChild(
  queryHandle: { close(): void } | undefined,
  child: SubprocessHandle,
): Promise<void> {
  const failures: Error[] = []
  try {
    queryHandle?.close()
  } catch (error) {
    failures.push(thrown(error))
  }
  child.terminate()
  try {
    await child.waitForExit()
  } catch (error) {
    failures.push(thrown(error))
  }
  const outcome = await child.done
  const firstFailure = failures[0]
  if (firstFailure !== undefined) {
    throw new ClaudeCodeFailure(
      {
        stage: 'teardown',
        category: 'unknown',
        outcome,
      },
      failures.length === 1
        ? firstFailure
        : new AggregateError(failures, 'Claude Code teardown failures'),
    )
  }
}

export interface ClaudeCodeRunSpec {
  readonly cwd: string
  readonly permissionMode: ClaudeCodePermissionMode
  readonly model?: string
  readonly effort?: 'low' | 'medium' | 'high'
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly projectMemory?: ClaudeSubagentMemory
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/**
 * Build the fixed official SDK options for one one-shot provider run.
 * @param spec - Workspace, environment, process service, and disposal policy.
 * @param controller - per-run cancellation owner.
 * @param capture - receives the shared child and SDK-facing process synchronously.
 * @param captureDiagnostic - receives safe facts from unattended interaction callbacks.
 * @returns options that inherit native settings while disabling persistence and user questions.
 */
export function claudeQueryOptions(
  spec: ClaudeCodeRunSpec,
  controller: AbortController,
  capture: (child: SubprocessHandle, process: ManagedClaudeCodeProcess) => void,
  captureDiagnostic: (diagnostic: string) => void,
): Options {
  const baseOptions: any = {
    abortController: controller,
    cwd: spec.cwd,
    env: {
      ...scrubbedParentEnv(),
      ...spec.env,
    },
    persistSession: false,
    disallowedTools:
      spec.permissionMode === 'plan'
        ? ['AskUserQuestion', 'ExitPlanMode']
        : ['AskUserQuestion'],
    permissionMode: spec.permissionMode,
    model: spec.model ?? DEFAULT_MODEL,
    effort: spec.effort ?? DEFAULT_EFFORT,
    ...(spec.projectMemory === undefined
      ? {}
      : {
          mcpServers: {
            'dsh-memory': spec.projectMemory.mcpServer,
          },
          allowedTools: [spec.projectMemory.allowedTool],
        }),
    ...(spec.permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {
          canUseTool: () => {
            captureDiagnostic(
              unattendedDiagnostic(
                spec.permissionMode,
                'tool permission',
                'denied',
                'the provider does not request human approval',
              ),
            )
            return Promise.resolve({
              behavior: 'deny' as const,
              message: 'This unattended Claude Code subagent cannot request human approval.',
            })
          },
        }),
    onElicitation: () => {
      captureDiagnostic(
        unattendedDiagnostic(
          spec.permissionMode,
          'MCP elicitation',
          'declined',
          'the provider does not collect interactive MCP input',
        ),
      )
      return Promise.resolve({ action: 'decline' as const })
    },
    onUserDialog: () => {
      captureDiagnostic(
        unattendedDiagnostic(
          spec.permissionMode,
          'user dialog',
          'cancelled',
          'the provider does not render blocking dialogs',
        ),
      )
      return Promise.resolve({ behavior: 'cancelled' as const })
    },
    supportedDialogKinds: SUPPORTED_UNATTENDED_DIALOG_KINDS,
    spawnClaudeCodeProcess: (options: SpawnOptions) => {
      const child = spec.spawn(claudeSpawnSpec(options, spec.disposeGraceMs))
      const process = new ManagedClaudeCodeProcess(child)
      capture(child, process)
      return process
    },
  }

  return baseOptions as Options
}

/**
 * Start one official Claude Agent SDK query and publish its one-shot run.
 * @param request - resolved shared subagent request.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run after both Query and real CLI handle exist.
 */
export async function startClaudeCodeRun(
  request: SubagentStartRequest,
  spec: ClaudeCodeRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  const prompt = claudePromptWithProjectMemory(task, spec.projectMemory?.bootstrap)
  if (request.signal.aborted) {
    throw new Error('subagent-claude-code: request was aborted before SDK startup')
  }

  const controller = new AbortController()
  const requestCancel = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('subagent-claude-code: run cancelled locally'))
    }
  }
  const onAbort = () => {
    requestCancel()
  }
  request.signal.addEventListener('abort', onAbort, { once: true })

  const reportFailure = (error: Error) => {
    try {
      spec.onError?.(error, 'error')
    } catch {}
  }

  let child: SubprocessHandle | undefined
  let queryInstance: Query | undefined
  let managedProcess: ManagedClaudeCodeProcess | undefined
  let diagnostic: string | undefined

  const capturePermissionDiagnostic = (value: string) => {
    diagnostic = value
  }
  const prependFailureDiagnostic = (facts: ClaudeCodeFailureFacts) => {
    const failure = failureDiagnostic(facts)
    diagnostic = diagnostic === undefined ? failure : `${failure}\n${diagnostic}`
  }
  const captureChild = (captured: SubprocessHandle, process: ManagedClaudeCodeProcess) => {
    child = captured
    managedProcess = process
  }

  try {
    queryInstance = query({
      prompt,
      options: claudeQueryOptions(spec, controller, captureChild, capturePermissionDiagnostic),
    })
    if (child === undefined || child.pid <= 0) {
      throw new Error(
        'subagent-claude-code: official SDK did not publish a controllable Claude Code process',
      )
    }
    if (controller.signal.aborted) {
      throw new Error('subagent-claude-code: request was aborted before SDK startup')
    }
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = controller.signal.aborted
    await Promise.resolve()
    const startupFacts: ClaudeCodeFailureFacts = {
      stage: 'query-start',
      category: 'unknown',
      outcome: managedProcess?.outcome,
    }
    const startupFailure = (cause = error) => new ClaudeCodeFailure(startupFacts, thrown(cause))
    requestCancel()
    if (child !== undefined && child.pid <= 0) {
      let closeError: Error | undefined
      try {
        queryInstance?.close()
      } catch (disposeError) {
        closeError = thrown(disposeError)
      }
      let spawnError = thrown(error)
      try {
        await child.done
      } catch (childError) {
        spawnError = thrown(childError)
      }
      if (closeError !== undefined) {
        const failure = startupFailure(spawnError)
        const cleanupFailure = new ClaudeCodeFailure(
          { stage: 'teardown', category: 'unknown' },
          closeError,
        )
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
      if (cancelledBeforeCleanup || isAborted(request.signal)) {
        throw new Error('subagent-claude-code: request was aborted before SDK startup')
      }
      const failure = startupFailure(spawnError)
      reportFailure(failure)
      throw failure
    }
    if (child !== undefined) {
      try {
        await disposeClaudeCodeChild(queryInstance, child)
      } catch (disposeError) {
        const failure = startupFailure()
        const cleanupFailure = thrown(disposeError)
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
    } else if (queryInstance !== undefined) {
      try {
        queryInstance.close()
      } catch (disposeError) {
        const failure = startupFailure()
        const cleanupFailure = new ClaudeCodeFailure(
          { stage: 'teardown', category: 'unknown' },
          thrown(disposeError),
        )
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
    }
    if (cancelledBeforeCleanup || isAborted(request.signal)) {
      throw new Error('subagent-claude-code: request was aborted before SDK startup')
    }
    const failure = startupFailure()
    reportFailure(failure)
    throw failure
  }

  const publishedQuery = queryInstance
  const publishedChild = child
  let receivedResult = false

  const result = (settleRunResult as any)({
    attempt: async () => {
      try {
        return await consumeClaudeQuery(
          publishedQuery,
          undefined,
          () => {
            capturePermissionDiagnostic(
              unattendedDiagnostic(
                spec.permissionMode,
                'tool permission',
                'denied',
                'Claude Code denied the request before an interactive prompt',
              ),
            )
          },
          () => {
            receivedResult = true
          },
        )
      } catch (error) {
        const processOutcome = managedProcess?.outcome
        let facts: ClaudeCodeFailureFacts
        if (error instanceof ClaudeCodeFailure) {
          facts = {
            ...error.facts,
            outcome: processOutcome,
          }
        } else if (processOutcome !== undefined && !receivedResult) {
          facts = {
            stage: 'process',
            category: 'process-exit',
            outcome: processOutcome,
          }
        } else {
          facts = {
            stage: 'query-run',
            category: 'unknown',
            outcome: processOutcome,
          }
        }
        prependFailureDiagnostic(facts)
        throw error instanceof ClaudeCodeFailure ? error : new ClaudeCodeFailure(facts, thrown(error))
      }
    },
    collectOutput: () => [],
    collectDiagnostic: () => diagnostic,
    cancelled: () => controller.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id: SessionId(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: async () => {
      try {
        await disposeClaudeCodeChild(publishedQuery, publishedChild)
      } catch (error) {
        const failure = thrown(error)
        reportFailure(failure)
        throw failure
      }
    },
  })
}
