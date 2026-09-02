/**
 * Official Codex app-server rate-limits source adapter.
 *
 * Uses the already-installed external Codex CLI and performs a short-lived
 * JSON-RPC read session without thread creation, model prompts, or credential
 * copying.
 *
 * @module nishi-dsh-codex/usage-source
 */
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { disposeVendorChild, outputLines } from 'nishi-dsh-core/runtime'
import {
  MINIMUM_CODEX_APP_SERVER_VERSION,
  codexAppServerVersionAtLeast,
  codexAppServerVersionFromUserAgent,
} from './codex-plugin-dsh/app-server.js'
import { CodexRateLimitsSourceError } from './usage.js'

const DEFAULT_DISPOSE_GRACE_MS = 3_000
const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024
/** Bound on captured vendor stderr for one usage probe. */
const USAGE_STDERR_MAX_BYTES = 64_000

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export interface OfficialCodexRateLimitsSourceSpec {
  readonly cwd: string
  /** Bare name or configured command; resolution belongs to the mounted DSH subprocess provider. */
  readonly executable?: string
  /** Explicit provider environment override. Parent-env construction belongs to the subprocess provider. */
  readonly env?: Readonly<Record<string, string>>
  readonly requestTimeoutMs?: number
  readonly disposeGraceMs?: number
  readonly resolveExecutable: (
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) => Promise<string>
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
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

function configuredCommand(spec: OfficialCodexRateLimitsSourceSpec): string {
  const explicit = spec.executable?.trim()
  return explicit && explicit.length > 0 ? explicit : 'codex'
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
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
    if (typeof spec.resolveExecutable !== 'function') {
      throw new Error('codex-usage: resolveExecutable must be a function')
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
    const command = configuredCommand(this.spec)
    const env = this.spec.env ?? {}

    const timeoutController = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const timeoutError = new Error('codex-usage: app-server request timed out')
    const timeout = new Promise<never>((_, reject) => {
      const onAbort = (): void => reject(timeoutError)
      timeoutController.signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => timeoutController.abort(timeoutError), timeoutMs)
      timer.unref?.()
    })
    void timeout.catch(() => {})

    let executable: string
    try {
      const resolution = this.spec.resolveExecutable(command, env, timeoutController.signal)
      void resolution.catch(() => {})
      executable = await Promise.race([resolution, timeout])
    } catch (resolutionError) {
      if (timer !== undefined) clearTimeout(timer)
      if (timeoutController.signal.aborted) throw timeoutError
      throw new CodexRateLimitsSourceError(
        'Codex CLI is unavailable',
        'UNAVAILABLE',
        { cause: thrown(resolutionError) },
      )
    }

    const argv = codexAppServerArgv(executable)
    let child: SubprocessHandle
    try {
      child = this.spec.spawn({
        argv,
        cwd: this.spec.cwd,
        // Captured, not inherited. `inherit` wrote raw vendor stderr straight to
        // the host process's own stderr, which was the one place in this package
        // where vendor-authored text reached a human unscrubbed -- credential
        // paths and network diagnostics included. Nothing reads this buffer on
        // the success path; it exists so those bytes have somewhere to go that
        // is not the operator's console.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: USAGE_STDERR_MAX_BYTES } },
        graceMs,
        env,
      })
    } catch (spawnError) {
      if (timer !== undefined) clearTimeout(timer)
      throw new CodexRateLimitsSourceError(
        'Codex App Server is unavailable',
        'UNAVAILABLE',
        { cause: thrown(spawnError) },
      )
    }
    if (!child || typeof child !== 'object') {
      if (timer !== undefined) clearTimeout(timer)
      throw new Error('codex-usage: spawn did not return a valid SubprocessHandle')
    }

    const stdout = child.stdout
    const stdin = child.stdin
    if (!stdout || !stdin) {
      if (timer !== undefined) clearTimeout(timer)
      await disposeVendorChild(child).catch(() => {})
      throw new Error('codex-usage: child process did not provide pipe stdio streams')
    }
    stdin.on?.('error', () => {})
    stdout.on('error', () => {})

    const initRequestId = 'req_init'
    const accountRequestId = 'req_account'
    const readRequestId = 'req_read'

    const exited = child.done.then(
      (outcome): never => {
        throw new CodexRateLimitsSourceError(
          `Codex App Server exited before the rate-limit read settled (code ${outcome.exitCode}, signal ${outcome.signal})`,
          'UNAVAILABLE',
        )
      },
      (processError): never => {
        throw new CodexRateLimitsSourceError(
          'Codex App Server process failed',
          'UNAVAILABLE',
          { cause: thrown(processError) },
        )
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
      let accountCompleted = false
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

        if (typeof frame.method === 'string' && frame.id === undefined) continue

        if (frame.id === initRequestId) {
          if (frame.error) {
            throw new Error(`codex-usage: initialize failed: ${jsonRpcErrorDetail(frame.error)}`)
          }
          const initialized = plainObject(frame.result)
          if (initialized === undefined) {
            throw new Error('codex-usage: initialize response result is invalid')
          }
          const version = codexAppServerVersionFromUserAgent(initialized.userAgent)
          if (version === undefined || !codexAppServerVersionAtLeast(version, MINIMUM_CODEX_APP_SERVER_VERSION)) {
            // An installed-but-unsupported Codex version is an availability
            // problem, not a collection error: the source spec only maps
            // CodexRateLimitsSourceError to a status, so an ordinary Error
            // here would collapse to ERROR instead of UNAVAILABLE.
            throw new CodexRateLimitsSourceError(
              `codex-usage: unsupported Codex App Server version ${JSON.stringify(version ?? initialized.userAgent)}; requires ${MINIMUM_CODEX_APP_SERVER_VERSION} or newer`,
              'UNAVAILABLE',
            )
          }
          initCompleted = true
          stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
          stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: accountRequestId,
            method: 'account/read',
            params: { refreshToken: false },
          })}\n`)
          continue
        }

        if (frame.id === accountRequestId) {
          if (!initCompleted) {
            throw new Error('codex-usage: account response received before initialize completed')
          }
          if (frame.error) {
            throw new Error(`codex-usage: account/read failed: ${jsonRpcErrorDetail(frame.error)}`)
          }
          const account = plainObject(frame.result)
          if (account === undefined) {
            throw new Error('codex-usage: account/read response result is invalid')
          }
          if (account.requiresOpenaiAuth === true && account.account == null) {
            throw new CodexRateLimitsSourceError(
              'Codex login is required; run `codex login` on the DSH host',
              'LOGIN_REQUIRED',
            )
          }
          accountCompleted = true
          stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: readRequestId, method: 'account/rateLimits/read' })}\n`)
          continue
        }

        if (frame.id === readRequestId) {
          if (!accountCompleted) {
            throw new Error('codex-usage: read response received before account status completed')
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
