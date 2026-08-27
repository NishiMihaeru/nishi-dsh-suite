/**
 * Official Codex app-server rate-limits source adapter.
 *
 * Uses the already-installed external Codex CLI and performs a short-lived
 * JSON-RPC read session without thread creation, model prompts, or credential
 * copying.
 *
 * @module nishi-dsh-provider-kit/codex-usage
 */
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveVendorExecutable, type VendorExecutableDescriptor } from './executable.js'
import { disposeVendorChild, outputLines } from './process.js'

const CODEX_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'codex-usage',
  defaultName: 'codex',
  envOverride: 'DSH_CODEX_EXECUTABLE',
}

const DEFAULT_DISPOSE_GRACE_MS = 3_000
const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export interface OfficialCodexRateLimitsSourceSpec {
  readonly cwd: string
  /** Programmatic override retained for compatibility; normal user override is DSH_CODEX_EXECUTABLE. */
  readonly executable?: string
  readonly env?: Readonly<Record<string, string>>
  readonly requestTimeoutMs?: number
  readonly disposeGraceMs?: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly onRateLimitsUpdated?: () => void
}

export interface CodexRateLimitsSourceLike {
  read(): Promise<unknown>
}

/** Build the argv for the official app-server stdio command. */
export function codexAppServerArgv(executable: string): string[] {
  return [executable, 'app-server', '--stdio']
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function assertPositiveFinite(owner: string, name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${owner}: ${name} must be a positive safe integer`)
  }
}

function jsonRpcErrorDetail(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as Record<string, unknown>).message)
    : JSON.stringify(error)
}

function resolvedExecutable(spec: OfficialCodexRateLimitsSourceSpec): string {
  const explicit = spec.executable?.trim()
  if (explicit) return explicit
  return resolveVendorExecutable(CODEX_DESCRIPTOR, {
    env: { ...process.env, ...spec.env },
  }).executable
}

export class OfficialCodexRateLimitsSource implements CodexRateLimitsSourceLike {
  private readonly spec: OfficialCodexRateLimitsSourceSpec

  constructor(spec: OfficialCodexRateLimitsSourceSpec) {
    if (!spec || typeof spec !== 'object') {
      throw new Error('codex-usage: spec must be a non-null object')
    }
    if (typeof spec.cwd !== 'string' || spec.cwd.trim().length === 0) {
      throw new Error('codex-usage: cwd must be a non-empty string')
    }
    if (typeof spec.spawn !== 'function') {
      throw new Error('codex-usage: spawn must be a function')
    }
    if (spec.requestTimeoutMs !== undefined) {
      assertPositiveFinite('codex-usage', 'requestTimeoutMs', spec.requestTimeoutMs)
      if (spec.requestTimeoutMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`codex-usage: requestTimeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
      }
    }
    if (spec.disposeGraceMs !== undefined) {
      assertPositiveFinite('codex-usage', 'disposeGraceMs', spec.disposeGraceMs)
      if (spec.disposeGraceMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`codex-usage: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
      }
    }
    this.spec = spec
  }

  async read(): Promise<unknown> {
    const timeoutMs = this.spec.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const graceMs = this.spec.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
    const executable = resolvedExecutable(this.spec)
    const argv = codexAppServerArgv(executable)
    const env = { ...scrubbedParentEnv(), ...this.spec.env }

    let child: SubprocessHandle
    try {
      child = this.spec.spawn({
        argv,
        cwd: this.spec.cwd,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
        graceMs,
        env,
      })
    } catch (spawnError) {
      throw thrown(spawnError)
    }
    if (!child || typeof child !== 'object') {
      throw new Error('codex-usage: spawn did not return a valid SubprocessHandle')
    }

    const stdout = child.stdout
    const stdin = child.stdin
    if (!stdout || !stdin) {
      await disposeVendorChild(child).catch(() => {})
      throw new Error('codex-usage: child process did not provide pipe stdio streams')
    }
    stdin.on?.('error', () => {})
    stdout.on('error', () => {})

    const initRequestId = 'req_init'
    const readRequestId = 'req_read'

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('codex-usage: app-server request timed out')),
        timeoutMs,
      )
      timer.unref?.()
    })
    void timeout.catch(() => {})

    const exited = child.done.then(
      (outcome): never => {
        throw new Error(
          `codex-usage: app-server exited before read settled (code ${outcome.exitCode}, signal ${outcome.signal})`,
        )
      },
      (processError): never => {
        throw thrown(processError)
      },
    )
    void exited.catch(() => {})

    const protocol = (async (): Promise<unknown> => {
      stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: initRequestId,
        method: 'initialize',
        params: {
          clientInfo: { name: 'deepseek-harness', title: 'DeepSeek Harness', version: '0.0.1' },
          capabilities: { experimentalApi: false, requestAttestation: false },
        },
      })}\n`)

      let initCompleted = false
      for await (const line of outputLines(stdout, MAX_PROTOCOL_LINE_BYTES)) {
        if (line.trim().length === 0) continue

        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          throw new Error('codex-usage: Malformed JSON protocol line received')
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('codex-usage: Invalid protocol message received')
        }
        const frame = parsed as Record<string, unknown>

        if (typeof frame.method === 'string' && frame.id === undefined) {
          if (frame.method === 'account/rateLimits/updated') {
            try { this.spec.onRateLimitsUpdated?.() } catch {}
          }
          continue
        }

        if (frame.id === initRequestId) {
          if (frame.error) {
            throw new Error(`codex-usage: initialize failed: ${jsonRpcErrorDetail(frame.error)}`)
          }
          if (frame.result === undefined || frame.result === null || typeof frame.result !== 'object') {
            throw new Error('codex-usage: initialize response result is invalid')
          }
          initCompleted = true
          stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
          stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: readRequestId, method: 'account/rateLimits/read' })}\n`)
          continue
        }

        if (frame.id === readRequestId) {
          if (!initCompleted) {
            throw new Error('codex-usage: read response received before initialize completed')
          }
          if (frame.error) {
            throw new Error(`codex-usage: account/rateLimits/read failed: ${jsonRpcErrorDetail(frame.error)}`)
          }
          if (frame.result === undefined) {
            throw new Error('codex-usage: account/rateLimits/read response missing result')
          }
          return frame.result
        }
      }
      throw new Error('codex-usage: app-server protocol stream closed')
    })()
    void protocol.catch(() => {})

    let rawResult: unknown
    let opError: unknown
    try {
      rawResult = await Promise.race([protocol, timeout, exited])
    } catch (error) {
      opError = error
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      try {
        await disposeVendorChild(child)
      } catch (disposeError) {
        const cleanupError = thrown(disposeError)
        if (opError !== undefined) {
          throw new AggregateError(
            [opError, cleanupError],
            'codex-usage: read failed and app-server cleanup also failed',
          )
        }
        throw cleanupError
      }
    }

    if (opError !== undefined) throw opError
    return rawResult
  }
}
