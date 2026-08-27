/**
 * Official Claude CLI usage/limits source adapter.
 *
 * Uses the already-installed external Claude CLI and performs a short-lived
 * stream-json control session that issues exactly one `get_usage` request
 * without a model turn, tools, MCP servers, or credential copying.
 *
 * @module nishi-dsh-provider-kit/claude-usage
 */

import { randomUUID } from 'node:crypto'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveVendorExecutable, type VendorExecutableDescriptor } from './executable.js'
import { disposeVendorChild, outputLines } from './process.js'

const CLAUDE_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'claude-usage',
  defaultName: 'claude',
  envOverride: 'DSH_CLAUDE_EXECUTABLE',
}

const MAX_CLAUDE_STREAM_LINE_BYTES = 1024 * 1024
const DEFAULT_DISPOSE_GRACE_MS = 3000
const DEFAULT_STDERR_MAX_BYTES = 16 * 1024

export const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 30_000

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
      `claude-usage: ${name} must be a positive finite integer <= ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return value
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Build the argv for a Claude usage control session: no model prompt, no tools, no MCP servers. */
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

  async read(): Promise<unknown> {
    if (this.spec.spawn === undefined) {
      throw new Error('claude-usage: usage source requires the DSH subprocess spawn service')
    }

    const env = { ...process.env, ...this.spec.env }
    const executable = this.spec.executable
      ?? resolveVendorExecutable(CLAUDE_DESCRIPTOR, { env }).executable
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
      await disposeVendorChild(child).catch(() => {})
      throw new Error('claude-usage: Claude usage control session did not expose stdio pipes')
    }
    stdin.on('error', () => {})
    stdout.on('error', () => {})

    const requestId = randomUUID()
    let timer: NodeJS.Timeout | undefined

    // Send the control request immediately rather than waiting for a
    // system/init line. Claude CLI 2.1.246 emits nothing at all on stdout
    // until it has received stdin input, so waiting for init deadlocks until
    // the request timeout. The CLI answers a get_usage control request sent as
    // the very first line, and an init line -- emitted by other versions --
    // needs no handling because the loop below ignores everything that is not
    // the matching control_response.
    stdin.write(`${JSON.stringify({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'get_usage' },
    })}\n`)

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('claude-usage: usage request timed out')
        if (!controller.signal.aborted) controller.abort(error)
        reject(error)
      }, this.timeoutMs)
      timer.unref?.()
    })
    void timeout.catch(() => {})

    const protocol = (async (): Promise<unknown> => {
      for await (const line of outputLines(stdout, MAX_CLAUDE_STREAM_LINE_BYTES)) {
        if (line.trim().length === 0) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch (error) {
          throw new Error('claude-usage: Claude usage control stream emitted malformed JSON', { cause: error })
        }
        const message = record(parsed)
        if (!message || typeof message.type !== 'string') continue
        if (message.type !== 'control_response') continue
        const response = record(message.response)
        if (response?.request_id !== requestId) continue
        if (response.subtype !== 'success') {
          throw new Error('claude-usage: Claude usage control request failed')
        }
        return response.response
      }
      throw new Error('claude-usage: Claude usage control session ended before get_usage response')
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
      if (!controller.signal.aborted) controller.abort(new Error('claude-usage: usage request complete'))
      try {
        await disposeVendorChild(child)
      } catch (cleanupError) {
        if (requestError !== undefined) {
          throw new AggregateError(
            [requestError, cleanupError],
            'claude-usage: usage request failed and CLI cleanup also failed',
          )
        }
        throw cleanupError
      }
    }

    if (requestError !== undefined) throw requestError
    return result
  }
}
