/**
 * One-shot Codex child lifecycle: spawn the real app-server through the
 * subprocess seam, publish only after initialization and ephemeral thread
 * creation, flatten post-publication failures, and dispose to whole-tree
 * quiescence.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-codex/src/run.ts
 *
 * Custom Policy Delta:
 * Injects three exact configuration overrides into the external Codex app-server invocation:
 * - -c memories.use_memories=false
 * - -c memories.generate_memories=false
 * - -c project_doc_max_bytes=0
 *
 * @module dsh-subagent-codex-custom/run
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { CodexSubagentMemory } from './memory.js'
import { CodexAppServerWire, type CodexWireFailureFacts } from './wire.js'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3000

/** Native non-interactive Codex modes mapped to official `thread/start` fields. */
export const CODEX_PERMISSION_MODES = [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
] as const

export type CodexPermissionMode = typeof CODEX_PERMISSION_MODES[number]

/** Safe default for unattended Codex runs. */
export const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = 'never'

export interface FailureDiagnosticsFacts extends CodexWireFailureFacts {
  readonly outcome?: SubprocessOutcome | undefined
}

function failureDiagnostic(facts: FailureDiagnosticsFacts): string {
  const fields = ['product: Codex', `stage: ${facts.stage}`, `category: ${facts.category}`]
  if (facts.httpStatus !== undefined) fields.push(`HTTP status: ${facts.httpStatus}`)
  const processFields: [string, unknown][] = [
    ['exit code', facts.outcome?.exitCode],
    ['signal', facts.outcome?.signal],
  ]
  for (const [label, value] of processFields) {
    if (value !== null && value !== undefined) fields.push(`${label}: ${value}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

export class CodexRunFailure extends Error {
  readonly facts: FailureDiagnosticsFacts

  constructor(facts: FailureDiagnosticsFacts, cause?: unknown) {
    super(`subagent-codex: ${failureDiagnostic(facts)}`, cause === undefined ? undefined : { cause })
    this.facts = facts
    this.name = 'CodexRunFailure'
  }
}

/**
 * Hide an unpublished Host failure behind fixed safe startup facts.
 * @param cause Original Host failure retained for internal diagnostics.
 * @returns A startup failure whose message contains only fixed safe facts.
 */
export function codexStartupFailure(cause: unknown): Error {
  return new CodexRunFailure(
    {
      stage: 'initialize',
      category: 'unknown',
    },
    cause,
  )
}

/**
 * External app-server command with custom memory and project doc suppression.
 * @param executable - resolved official Codex CLI executable.
 * @returns the executable, 3 memory policy overrides, and app-server --stdio.
 */
export function codexAppServerArgv(executable: string): string[] {
  return [
    executable,
    '-c',
    'memories.use_memories=false',
    '-c',
    'memories.generate_memories=false',
    '-c',
    'project_doc_max_bytes=0',
    'app-server',
    '--stdio',
  ]
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact non-empty text block sequence.
 */
export function textTask(prompt: readonly ContentBlock[]): string[] {
  if (prompt.length === 0) {
    throw new Error('subagent-codex: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-codex: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every((text) => text.trim().length === 0)) {
    throw new Error('subagent-codex: the one-shot task must not be empty')
  }
  return texts
}

export interface CodexRunSpec {
  readonly cwd: string
  readonly executable: string
  readonly permissionMode: CodexPermissionMode
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly projectMemory?: CodexSubagentMemory
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/**
 * Close the private wire, terminate the managed process tree, and wait for the
 * subprocess owner to prove it is gone.
 */
export async function disposeCodexChild(
  wire: CodexAppServerWire,
  child: SubprocessHandle,
): Promise<void> {
  wire.close()
  if (child.pid > 0) {
    let outcome: SubprocessOutcome | undefined
    child.done.then(
      (value) => {
        outcome = value
      },
      () => {},
    )
    try {
      child.stdin?.end()
    } catch {}
    child.terminate()
    try {
      await child.waitForExit()
    } catch (error) {
      throw new CodexRunFailure(
        {
          stage: 'teardown',
          category: 'unknown',
          outcome,
        },
        thrown(error),
      )
    }
    await child.done
  } else {
    await child.done.catch(() => {})
  }
}

/** Start the real external `codex app-server --stdio` child and publish its one-shot run. */
export async function startCodexRun(
  request: SubagentStartRequest,
  spec: CodexRunSpec,
): Promise<SubagentRun> {
  const texts = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-codex: request was aborted before app-server startup')
  }

  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: codexAppServerArgv(spec.executable),
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error) {
    throw new CodexRunFailure(
      {
        stage: 'initialize',
        category: 'unknown',
      },
      thrown(error),
    )
  }

  const wire = new CodexAppServerWire(
    child.stdout!,
    child.stdin!,
    spec.permissionMode,
    spec.projectMemory,
  )
  const onStderr = (chunk: unknown) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    wire.observeStderr(bytes.toString())
    try {
      writeFileSync(process.stderr.fd, bytes)
    } catch {}
  }
  const onStderrError = () => {}
  child.stderr?.on('data', onStderr)
  child.stderr?.on('error', onStderrError)

  const disposeProcess = async () => {
    try {
      await disposeCodexChild(wire, child)
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
    } finally {
      child.stderr?.off('data', onStderr)
      child.stderr?.off('error', onStderrError)
    }
  }

  let processFailureFacts: FailureDiagnosticsFacts | undefined
  const processFailure = child.done.then(
    (outcome) => {
      processFailureFacts = {
        stage: 'process',
        category: 'process-exit',
        outcome,
      }
      throw new CodexRunFailure(processFailureFacts)
    },
    (error) => {
      processFailureFacts = {
        stage: 'process',
        category: 'unknown',
      }
      throw new CodexRunFailure(processFailureFacts, thrown(error))
    },
  )
  processFailure.catch(() => {})

  const runAbort = new AbortController()
  const requestCancel = () => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-codex: run cancelled locally'))
    wire.interrupt()
  }
  const onAbort = () => {
    requestCancel()
  }
  request.signal.addEventListener('abort', onAbort, { once: true })

  let startupStage: 'initialize' | 'thread-start' = 'initialize'
  try {
    wire.start()
    await Promise.race([wire.initialize(request.signal), processFailure])
    startupStage = 'thread-start'
    await Promise.race([wire.startThread(spec.cwd, request.signal), processFailure])
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = runAbort.signal.aborted
    if (!(error instanceof CodexRunFailure) && !cancelledBeforeCleanup) {
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
    }
    const failure = new CodexRunFailure(
      {
        stage: startupStage,
        category: 'unknown',
        outcome:
          error instanceof CodexRunFailure
            ? error.facts.outcome
            : processFailureFacts?.outcome,
      },
      thrown(error),
    )
    try {
      await disposeProcess()
    } catch (disposeError) {
      const cleanupFailure = thrown(disposeError)
      throw new AggregateError(
        [failure, cleanupFailure],
        `${failure.message}; ${cleanupFailure.message}`,
      )
    }
    if (cancelledBeforeCleanup) {
      throw new Error('subagent-codex: request was aborted before run publication')
    }
    try {
      request.signal.throwIfAborted()
    } catch {
      throw new Error('subagent-codex: request was aborted before run publication')
    }
    throw failure
  }

  const collectOutput = () => wire.collectOutput()
  let diagnostic: string | undefined

  const recordFailureDiagnostic = (facts: FailureDiagnosticsFacts): string => {
    const failure = failureDiagnostic(facts)
    const permission = wire.collectDiagnostic()
    diagnostic = permission === undefined ? failure : `${failure}\n${permission}`
    return diagnostic
  }

  const withProcessOutcome = (facts: CodexWireFailureFacts): FailureDiagnosticsFacts => {
    const outcome = processFailureFacts?.outcome
    return outcome === undefined ? facts : { ...facts, outcome }
  }

  const publishedProcessFailure = processFailure.catch(async (error) => {
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    throw error
  })

  const result = (settleRunResult as any)({
    attempt: async () => {
      try {
        const terminal = await Promise.race([
          wire.runTurn(texts, runAbort.signal),
          publishedProcessFailure,
        ])
        if (terminal.stopReason === 'completed') return terminal
        await new Promise((resolve) => {
          setImmediate(resolve)
        })
        const facts = withProcessOutcome(wire.collectFailure())
        return {
          ...terminal,
          diagnostic: recordFailureDiagnostic(facts),
        }
      } catch (error) {
        await new Promise((resolve) => {
          setImmediate(resolve)
        })
        const endedBeforeTerminal = wire.endedBeforeTerminal()
        if (endedBeforeTerminal && processFailureFacts === undefined && !runAbort.signal.aborted) {
          try {
            if (await child.waitForExit(AbortSignal.timeout(Math.ceil(spec.disposeGraceMs)))) {
              await child.done
            }
          } catch {}
        }
        const facts =
          error instanceof CodexRunFailure
            ? error.facts
            : endedBeforeTerminal && processFailureFacts !== undefined
              ? processFailureFacts
              : withProcessOutcome(wire.collectFailure())
        recordFailureDiagnostic(facts)
        throw error instanceof CodexRunFailure
          ? error
          : new CodexRunFailure(facts, thrown(error))
      }
    },
    collectOutput,
    collectDiagnostic: () => diagnostic,
    cancelled: () => runAbort.signal.aborted,
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
    teardown: disposeProcess,
  })
}
