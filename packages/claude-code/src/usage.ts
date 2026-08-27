/** Claude Code usage source over the official external CLI control protocol. */

import { randomUUID } from 'node:crypto'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveClaudeExecutable } from './executable.js'
import { claudeOutputLines, disposeClaudeCliChild } from './process.js'
import { DEFAULT_DISPOSE_GRACE_MS } from './run.js'

export const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_STDERR_MAX_BYTES = 16 * 1024

export interface OfficialClaudeUsageSourceSpec {
  readonly cwd: string
  readonly executable?: string
  readonly env?: Record<string, string>
  readonly requestTimeoutMs?: number
  readonly disposeGraceMs?: number
  readonly spawn?: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

function positiveTimer(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-claude-code: ${name} must be a positive finite integer <= ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return value
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function claudeUsageCliArgv(executable: string): string[] {
  return [
    executable,
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--tools', '',
    '--strict-mcp-config',
  ]
}

export class OfficialClaudeUsageSource {
  private readonly spec: OfficialClaudeUsageSourceSpec
  private readonly timeoutMs: number
  private readonly graceMs: number

  constructor(spec: OfficialClaudeUsageSourceSpec) {
    this.timeoutMs = positiveTimer(
      spec.requestTimeoutMs,
      'requestTimeoutMs',
      DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
    )
    this.graceMs = positiveTimer(
      spec.disposeGraceMs,
      'disposeGraceMs',
      DEFAULT_DISPOSE_GRACE_MS,
    )
    this.spec = spec
  }

  async getUsage(): Promise<unknown> {
    if (this.spec.spawn === undefined) {
      throw new Error('subagent-claude-code: usage source requires the DSH subprocess spawn service')
    }

    const env = { ...process.env, ...this.spec.env }
    const executable = this.spec.executable ?? resolveClaudeExecutable({ env }).executable
    const controller = new AbortController()
    const child = this.spec.spawn({
      argv: claudeUsageCliArgv(executable),
      cwd: this.spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: DEFAULT_STDERR_MAX_BYTES },
      },
      graceMs: this.graceMs,
      signal: controller.signal,
      env: {
        ...scrubbedParentEnv(),
        ...this.spec.env,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      },
    })

    const stdin = child.stdin
    const stdout = child.stdout
    if (!stdin || !stdout) {
      await disposeClaudeCliChild(child).catch(() => {})
      throw new Error('subagent-claude-code: Claude usage control session did not expose stdio pipes')
    }
    stdin.on('error', () => {})
    stdout.on('error', () => {})

    const requestId = randomUUID()
    let requestSent = false
    let timer: NodeJS.Timeout | undefined

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('subagent-claude-code: usage request timed out')
        if (!controller.signal.aborted) controller.abort(error)
        reject(error)
      }, this.timeoutMs)
      timer.unref?.()
    })
    void timeout.catch(() => {})

    const protocol = (async (): Promise<unknown> => {
      for await (const line of claudeOutputLines(stdout)) {
        if (line.trim().length === 0) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch (error) {
          throw new Error('subagent-claude-code: Claude usage control stream emitted malformed JSON', { cause: error })
        }
        const message = record(parsed)
        if (!message || typeof message.type !== 'string') continue

        if (!requestSent && message.type === 'system' && message.subtype === 'init') {
          requestSent = true
          stdin.write(`${JSON.stringify({
            type: 'control_request',
            request_id: requestId,
            request: { subtype: 'get_usage' },
          })}\n`)
          continue
        }

        if (message.type !== 'control_response') continue
        const response = record(message.response)
        if (response?.request_id !== requestId) continue
        if (response.subtype !== 'success') {
          throw new Error('subagent-claude-code: Claude usage control request failed')
        }
        return response.response
      }
      throw new Error('subagent-claude-code: Claude usage control session ended before get_usage response')
    })()
    void protocol.catch(() => {})

    let result: unknown = undefined
    let requestError: unknown = undefined
    try {
      result = await Promise.race([protocol, timeout])
    } catch (error) {
      requestError = error
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (!controller.signal.aborted) controller.abort(new Error('subagent-claude-code: usage request complete'))
      try {
        await disposeClaudeCliChild(child)
      } catch (cleanupError) {
        if (requestError !== undefined) {
          throw new AggregateError(
            [requestError, cleanupError],
            'subagent-claude-code: usage request failed and CLI cleanup also failed',
          )
        }
        throw cleanupError
      }
    }

    if (requestError !== undefined) throw requestError
    return result
  }
}
