import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
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
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { CodexSubagentMemory } from './memory.js'

const AGENT_NAME = 'dsh-subagent'
const WINDOWS_EXECUTABLE_ENV = 'DSH_ANTIGRAVITY_SUBAGENT_CLI_EXECUTABLE'

export const DEFAULT_ANTIGRAVITY_SUBAGENT_MODEL = 'gemini-3.7-flash-medium'
export const DEFAULT_ANTIGRAVITY_SUBAGENT_EFFORT = 'medium'

interface AgyTurnResult {
  readonly status?: unknown
  readonly response?: unknown
  readonly error?: unknown
}

interface Invocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

interface AgyStream {
  readonly initialized: Promise<void>
  readonly result: Promise<AgyTurnResult>
  close(): void
}

export interface AntigravitySubagentRunSpec {
  readonly cwd: string
  readonly executable: string
  readonly env: Record<string, string>
  readonly model: string
  readonly effort?: string
  readonly turnTimeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
  readonly projectMemory?: CodexSubagentMemory
  readonly resolveExecutable: (
    executable: string,
    env?: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<string>
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function stripAnsi(value: unknown): string {
  return String(value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function antigravitySubagentTextTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-antigravity: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-antigravity: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-antigravity: the one-shot task must not be empty')
  }
  return texts.join('')
}

export function antigravitySubagentPrompt(
  task: string,
  bootstrap?: string | null,
  cwd?: string,
): string {
  const memory = bootstrap == null || bootstrap.length === 0
    ? ''
    : `\n\n${bootstrap}\n`
  const workspaceLine = cwd
    ? `- The active working directory and DSH project workspace is: ${cwd}\n- When inspecting or modifying project files, resolve paths relative to this project workspace.`
    : '- The active working directory is the DSH project workspace.'
  return `You are an ephemeral Antigravity coding subagent delegated by DeepSeek Harness (DSH).\n\n- Work only on the delegated task.\n${workspaceLine}\n- You may inspect and edit project files and run commands using the tools allowed by this managed agent.\n- Do not spawn Antigravity-native subagents.\n- Do not create or use provider-specific durable project memory.\n- DSH-owned project memory included below is read-only authoritative context; do not edit .dsh/memory files.\n- Do not ask the user interactive questions. Make a best effort and return a concise final result to the parent DSH agent.\n${memory}\n## Delegated task\n${task}`
}

function managedAgentMarkdown(): string {
  return `---\nname: ${AGENT_NAME}\ndescription: Ephemeral coding worker delegated by DeepSeek Harness.\nmainAgent: true\nsubagent: false\ninheritCustomizations: false\ntools:\n  - view_file\n  - write_to_file\n  - replace_file_content\n  - multi_replace_file_content\n  - grep_search\n  - run_command\n  - finish\n---\n\n# DSH Managed Worker\n\nExecute only the task supplied in the prompt. Do not invoke or create native subagents. Do not create provider-owned durable memory. Respect the active workspace boundary and the Antigravity CLI permission policy.\n`
}

async function createBridgeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-antigravity-subagent-'))
  const agentDir = join(root, '.agents', 'agents', AGENT_NAME)
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'agent.md'), managedAgentMarkdown(), 'utf8')
  return root
}

async function resolveInvocation(
  spec: AntigravitySubagentRunSpec,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<Invocation> {
  const executable = await spec.resolveExecutable(spec.executable, spec.env, signal)
  const extension = extname(executable).toLowerCase()
  if (process.platform !== 'win32' || (extension !== '.cmd' && extension !== '.bat')) {
    return { argv: [executable, ...args], env: spec.env }
  }
  const commandInterpreter = await spec.resolveExecutable('cmd.exe', spec.env, signal)
  return {
    argv: [commandInterpreter, '/d', '/v:off', '/s', '/c', `%${WINDOWS_EXECUTABLE_ENV}%`, ...args],
    env: { ...spec.env, [WINDOWS_EXECUTABLE_ENV]: `\"${executable}\"` },
  }
}

function extractResponseText(result: AgyTurnResult): string | undefined {
  if (typeof result.response === 'string') {
    const trimmed = result.response.trim()
    if (trimmed.length > 0) return result.response
  }
  return undefined
}

function observeAgyStream(child: SubprocessHandle): AgyStream {
  const stdout = child.stdout
  if (!stdout) throw new Error('subagent-antigravity: agy subprocess did not expose stdout')
  stdout.setEncoding('utf8')
  const lines = createInterface({ input: stdout, crlfDelay: Infinity })

  let initSettled = false
  let resultSettled = false
  let resolveInit!: () => void
  let rejectInit!: (error: Error) => void
  let resolveResult!: (result: AgyTurnResult) => void
  let rejectResult!: (error: Error) => void

  const initialized = new Promise<void>((resolve, reject) => {
    resolveInit = resolve
    rejectInit = reject
  })
  const result = new Promise<AgyTurnResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  void result.catch(() => {})

  const fail = (error: Error): void => {
    if (!initSettled) {
      initSettled = true
      rejectInit(error)
    }
    if (!resultSettled) {
      resultSettled = true
      rejectResult(error)
    }
  }

  lines.on('line', line => {
    const trimmed = stripAnsi(line).trim()
    if (!trimmed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      fail(new Error('subagent-antigravity: agy emitted non-JSON stdout in stream-json mode'))
      return
    }
    const row = record(parsed)
    if (!row) return
    if (row.event === 'init') {
      if (!initSettled) {
        initSettled = true
        resolveInit()
      }
      return
    }
    if (row.event === 'result') {
      if (!initSettled) {
        fail(new Error('subagent-antigravity: agy emitted result before init'))
        return
      }
      if (!resultSettled) {
        resultSettled = true
        resolveResult((record(row.result) ?? {}) as AgyTurnResult)
      }
    }
  })

  lines.on('close', () => {
    if (!initSettled) {
      initSettled = true
      rejectInit(new Error('subagent-antigravity: agy exited before init'))
    }
    if (!resultSettled) {
      resultSettled = true
      rejectResult(new Error('subagent-antigravity: agy exited before a result event'))
    }
  })

  return {
    initialized,
    result,
    close() { lines.close() },
  }
}

async function disposeChild(child: SubprocessHandle | undefined, stream?: AgyStream): Promise<void> {
  if (!child) return
  stream?.close()
  child.terminate()
  await child.waitForExit().catch(() => false)
  await child.done.catch(() => undefined)
}


/**
 * The Antigravity CLI auto-denies tool permissions in headless mode because it
 * cannot prompt, and reports that clearly on stderr while ending the turn as
 * CANCELED. Without this the run surfaced as a bare "aborted" with no
 * diagnostic at all, which is indistinguishable from a user cancellation.
 *
 * Only the recognised condition is turned into a message; raw vendor stderr is
 * never forwarded, so local paths and vendor output still cannot escape.
 */
const PERMISSION_DENIED_PATTERN = /required the "([a-z_]+)" permission that headless mode cannot prompt for/i

export function headlessPermissionDenial(stderrText: string | undefined): string | undefined {
  if (typeof stderrText !== 'string' || stderrText.length === 0) return undefined
  const match = PERMISSION_DENIED_PATTERN.exec(stderrText)
  if (!match) return undefined
  return `Product subagent failure (product: Antigravity CLI; stage: turn; category: permission-denied). `
    + `The CLI auto-denied the ${JSON.stringify(match[1])} tool permission because headless mode cannot ask for approval. `
    + `Allow it in the Antigravity CLI permission settings, then retry.`
}

function vendorStderrText(child: SubprocessHandle): string | undefined {
  try {
    return (child as any).collected?.stderr?.readFrom?.(0)?.text
  } catch {
    return undefined
  }
}

/**
 * The CLI writes its explanation to stderr AFTER emitting the terminal result
 * frame, so reading stderr the moment the frame arrives always sees an empty
 * buffer. Wait a bounded amount for the process to finish before looking.
 */
async function settledVendorStderr(
  child: SubprocessHandle,
  graceMs: number,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      child.done.then(() => undefined, () => undefined),
      new Promise<void>((resolveWait) => {
        timer = setTimeout(resolveWait, graceMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return vendorStderrText(child)
}

export async function startAntigravitySubagentRun(
  request: SubagentStartRequest,
  spec: AntigravitySubagentRunSpec,
): Promise<SubagentRun> {
  const task = antigravitySubagentTextTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-antigravity: request was aborted before agy startup')
  }

  const bridgeRoot = await createBridgeRoot()
  const prompt = antigravitySubagentPrompt(task, spec.projectMemory?.bootstrap, spec.cwd)
  const runAbort = new AbortController()
  const timeout = AbortSignal.timeout(spec.turnTimeoutMs)
  const signal = AbortSignal.any([request.signal, runAbort.signal, timeout])
  const args = [
    '--add-dir', bridgeRoot,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--agent', AGENT_NAME,
    '--model', spec.model,
    ...(spec.effort === undefined ? [] : ['--effort', spec.effort]),
    '--print-timeout', `${Math.max(1, Math.ceil(spec.turnTimeoutMs / 1000))}s`,
  ]

  let child: SubprocessHandle | undefined
  let stream: AgyStream | undefined
  try {
    const invocation = await resolveInvocation(spec, args, signal)
    child = spec.spawn({
      argv: [...invocation.argv],
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: spec.stderrMaxBytes },
      },
      graceMs: spec.disposeGraceMs,
      signal,
      env: { ...invocation.env },
    })
    if (!child.stdin) {
      throw new Error('subagent-antigravity: agy subprocess did not expose stdin')
    }
    child.stdin.on('error', () => {})
    stream = observeAgyStream(child)
    const payload = `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`
    child.stdin.write(payload)
    await stream.initialized
  } catch (error) {
    await disposeChild(child, stream).catch(() => {})
    await rm(bridgeRoot, { recursive: true, force: true }).catch(() => {})
    if (request.signal.aborted) {
      throw new Error('subagent-antigravity: request was aborted before run publication')
    }
    if (timeout.aborted) {
      throw new Error(`subagent-antigravity: agy startup timed out after ${spec.turnTimeoutMs}ms`)
    }
    throw new Error('subagent-antigravity: failed to start official agy runtime', { cause: thrown(error) })
  }

  const publishedChild = child
  const publishedStream = stream
  let diagnostic: string | undefined
  let partialOutput: ContentBlock[] = []

  const requestCancel = () => {
    if (!runAbort.signal.aborted) {
      runAbort.abort(new Error('subagent-antigravity: run cancelled locally'))
    }
    publishedChild.terminate()
  }
  const onAbort = () => requestCancel()
  request.signal.addEventListener('abort', onAbort, { once: true })

  const result = settleRunResult({
    attempt: async () => {
      try {
        const terminal = await publishedStream.result
        try { publishedChild.stdin?.end() } catch {}

        const responseText = extractResponseText(terminal)
        if (responseText !== undefined) {
          partialOutput = [{ type: 'text' as const, text: responseText }]
        }

        if (request.signal.aborted || runAbort.signal.aborted) {
          return { output: partialOutput, stopReason: 'aborted' as const }
        }
        if (timeout.aborted) {
          diagnostic = 'Product subagent failure (product: Antigravity CLI; stage: turn; category: timeout)'
          throw new Error(`subagent-antigravity: agy turn timed out after ${spec.turnTimeoutMs}ms`)
        }

        const rawStatus = terminal.status
        const status = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : String(rawStatus ?? '')

        if (status === 'CANCELED' || status === 'INTERRUPTED') {
          const denial = headlessPermissionDenial(await settledVendorStderr(publishedChild, spec.disposeGraceMs))
          if (denial !== undefined) {
            diagnostic = denial
            throw new Error('subagent-antigravity: agy auto-denied a tool permission in headless mode')
          }
          return { output: partialOutput, stopReason: 'aborted' as const }
        }

        if (status !== 'SUCCESS') {
          diagnostic = headlessPermissionDenial(await settledVendorStderr(publishedChild, spec.disposeGraceMs))
            ?? 'Product subagent failure (product: Antigravity CLI; stage: turn; category: provider-error)'
          const detail = typeof terminal.error === 'string' && terminal.error.length > 0
            ? terminal.error
            : `status ${status || 'UNKNOWN'}`
          throw new Error(`subagent-antigravity: agy turn failed: ${detail}`)
        }

        if (partialOutput.length === 0) {
          diagnostic = 'Product subagent failure (product: Antigravity CLI; stage: turn; category: provider-error)'
          throw new Error('subagent-antigravity: agy returned no final response')
        }

        return {
          output: partialOutput,
          stopReason: 'completed' as const,
        }
      } catch (error) {
        if (diagnostic === undefined) {
          diagnostic = timeout.aborted
            ? 'Product subagent failure (product: Antigravity CLI; stage: turn; category: timeout)'
            : 'Product subagent failure (product: Antigravity CLI; stage: turn; category: provider-error)'
        }
        throw error
      }
    },
    collectOutput: () => partialOutput,
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
    teardown: async () => {
      try {
        await disposeChild(publishedChild, publishedStream)
      } finally {
        await rm(bridgeRoot, { recursive: true, force: true }).catch(() => {})
      }
    },
  })
}
