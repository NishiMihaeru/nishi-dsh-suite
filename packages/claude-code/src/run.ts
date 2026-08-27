/** Direct one-shot Claude Code CLI lifecycle under the shared subprocess owner. */

import { randomUUID } from 'node:crypto'
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
import { resolveClaudeExecutable } from './executable.js'
import {
  claudePromptWithProjectMemory,
  startClaudeMemoryMcpBridge,
  type ClaudeSubagentMemory,
  type ClaudeMemoryMcpBridge,
} from './memory.js'
import { claudeOutputLines, disposeClaudeCliChild } from './process.js'
import { ClaudeStreamFailure, consumeClaudeStream } from './stream.js'

export const DEFAULT_DISPOSE_GRACE_MS = 3000
export const CLAUDE_CODE_PERMISSION_MODES = [
  'dontAsk',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
] as const
export type ClaudeCodePermissionMode = typeof CLAUDE_CODE_PERMISSION_MODES[number]
export const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = 'auto'
export const DEFAULT_MODEL = 'claude-sonnet-5'
export const DEFAULT_EFFORT: 'low' | 'medium' | 'high' = 'high'
const DEFAULT_STDERR_MAX_BYTES = 16 * 1024

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
    this.name = 'ClaudeCodeFailure'
    this.facts = facts
  }
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

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

export interface ClaudeCliArgvOptions {
  readonly executable: string
  readonly model: string
  readonly effort: 'low' | 'medium' | 'high'
  readonly permissionMode: ClaudeCodePermissionMode
  readonly prompt: string
  readonly memory?: {
    readonly mcpConfig: string
    readonly allowedTool: string
  }
}

/** Build the documented non-interactive Claude Code invocation for one run. */
export function claudeCliArgv(options: ClaudeCliArgvOptions): string[] {
  const disallowedTools = options.permissionMode === 'plan'
    ? 'AskUserQuestion,ExitPlanMode'
    : 'AskUserQuestion'
  const memoryArgs = options.memory === undefined
    ? []
    : [
        '--strict-mcp-config',
        '--mcp-config', options.memory.mcpConfig,
        '--allowedTools', options.memory.allowedTool,
      ]

  return [
    options.executable,
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--model', options.model,
    '--effort', options.effort,
    '--permission-mode', options.permissionMode,
    '--disallowedTools', disallowedTools,
    ...memoryArgs,
    options.prompt,
  ]
}

export interface ExecuteClaudeCliSpec {
  readonly cwd: string
  readonly executable: string
  readonly model: string
  readonly effort: 'low' | 'medium' | 'high'
  readonly permissionMode: ClaudeCodePermissionMode
  readonly prompt: string
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly memory?: {
    readonly mcpConfig: string
    readonly allowedTool: string
  }
  readonly onUsageInvalidated?: () => void
  readonly onPermissionDenied?: () => void
}

/** Execute one external Claude CLI request and always quiesce its process tree. */
export async function executeClaudeCli(
  spec: ExecuteClaudeCliSpec,
  signal: AbortSignal,
): Promise<{ output: ContentBlock[]; stopReason: SubagentStopReason }> {
  if (signal.aborted) throw new Error('subagent-claude-code: run aborted before Claude CLI startup')

  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: claudeCliArgv({
        executable: spec.executable,
        model: spec.model,
        effort: spec.effort,
        permissionMode: spec.permissionMode,
        prompt: spec.prompt,
        memory: spec.memory,
      }),
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: DEFAULT_STDERR_MAX_BYTES },
      },
      graceMs: spec.disposeGraceMs,
      signal,
      env: {
        ...scrubbedParentEnv(),
        ...spec.env,
      },
    })
  } catch (error) {
    throw new ClaudeCodeFailure({ stage: 'query-start', category: 'spawn' }, error)
  }

  const stdout = child.stdout
  if (!stdout) {
    const outcome = await disposeClaudeCliChild(child).catch(() => undefined)
    throw new ClaudeCodeFailure({ stage: 'query-start', category: 'missing-stdout', outcome })
  }
  stdout.on('error', () => {})
  child.stdin?.on('error', () => {})

  let disposePromise: Promise<SubprocessOutcome> | undefined
  const dispose = (): Promise<SubprocessOutcome> => {
    disposePromise ??= disposeClaudeCliChild(child)
    return disposePromise
  }
  const onAbort = () => { void dispose().catch(() => {}) }
  signal.addEventListener('abort', onAbort, { once: true })

  let abortListener: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('subagent-claude-code: run aborted'))
      return
    }
    abortListener = () => reject(new Error('subagent-claude-code: run aborted'))
    signal.addEventListener('abort', abortListener, { once: true })
  })
  void abortPromise.catch(() => {})

  let result: { text: string; stopReason: 'completed' } | undefined
  let runError: unknown
  try {
    result = await Promise.race([
      consumeClaudeStream(claudeOutputLines(stdout), {
        onUsageInvalidated: spec.onUsageInvalidated,
        onPermissionDenied: spec.onPermissionDenied,
      }),
      abortPromise,
    ])
  } catch (error) {
    runError = error
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (abortListener !== undefined) signal.removeEventListener('abort', abortListener)
  }

  let outcome: SubprocessOutcome | undefined
  try {
    outcome = await dispose()
  } catch (error) {
    if (runError !== undefined) {
      throw new AggregateError(
        [thrown(runError), thrown(error)],
        'subagent-claude-code: run failed and Claude CLI cleanup also failed',
      )
    }
    throw new ClaudeCodeFailure({ stage: 'teardown', category: 'cleanup' }, error)
  }

  if (signal.aborted) throw new Error('subagent-claude-code: run aborted')
  if (runError !== undefined) {
    if (runError instanceof ClaudeStreamFailure || runError instanceof ClaudeCodeFailure) throw runError
    const stderr = child.collected.stderr?.readFrom(0).text
    throw new ClaudeCodeFailure(
      { stage: 'process', category: 'process-exit', outcome },
      stderr ? new Error(stderr) : runError,
    )
  }
  if (result === undefined) {
    throw new ClaudeCodeFailure({ stage: 'query-run', category: 'missing-result', outcome })
  }

  return {
    output: [{ type: 'text', text: result.text }],
    stopReason: result.stopReason,
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

export async function startClaudeCodeRun(
  request: SubagentStartRequest,
  spec: ClaudeCodeRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-claude-code: request was aborted before Claude CLI startup')
  }

  const executable = resolveClaudeExecutable({
    env: { ...process.env, ...spec.env },
  }).executable
  const controller = new AbortController()
  const requestCancel = () => {
    if (!controller.signal.aborted) controller.abort(new Error('subagent-claude-code: run cancelled locally'))
  }
  const onAbort = () => requestCancel()
  request.signal.addEventListener('abort', onAbort, { once: true })

  let memoryBridge: ClaudeMemoryMcpBridge | undefined
  if (spec.projectMemory !== undefined) {
    memoryBridge = await startClaudeMemoryMcpBridge(spec.projectMemory.context, controller.signal)
  }

  const prompt = claudePromptWithProjectMemory(task, spec.projectMemory?.bootstrap)
  let diagnostic: string | undefined
  let activeExecution: Promise<{ output: ContentBlock[]; stopReason: SubagentStopReason }> | undefined

  const result = (settleRunResult as any)({
    attempt: async () => {
      try {
        activeExecution = executeClaudeCli({
          cwd: spec.cwd,
          executable,
          model: spec.model ?? DEFAULT_MODEL,
          effort: spec.effort ?? DEFAULT_EFFORT,
          permissionMode: spec.permissionMode,
          prompt,
          env: spec.env,
          disposeGraceMs: spec.disposeGraceMs,
          spawn: spec.spawn,
          memory: memoryBridge === undefined
            ? undefined
            : {
                mcpConfig: memoryBridge.mcpConfig,
                allowedTool: memoryBridge.allowedTool,
              },
          onPermissionDenied: () => {
            diagnostic = 'Claude Code denied a tool request in unattended mode.'
          },
        }, controller.signal)
        return await activeExecution
      } finally {
        await memoryBridge?.close().catch(() => {})
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
      requestCancel()
      if (activeExecution !== undefined) await activeExecution.catch(() => {})
      await memoryBridge?.close()
    },
  })
}
