/**
 * Official Codex app-server rate-limits source adapter.
 *
 * Uses the already-installed external Codex CLI and performs a short-lived
 * JSON-RPC read session without thread creation, model prompts, or credential
 * copying. Spawn and protocol match the primary adapter: the same
 * `codexAppServerInvocation` (Windows batch shim and memory-policy
 * overrides) and `CodexAppServerConnection`.
 *
 * @module nishi-dsh-codex/usage-source
 */
import { extname } from 'node:path'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { disposeVendorChild } from 'nishi-dsh-core/runtime'
import { CodexAppServerConnection } from './codex-plugin-dsh/app-server.js'
import { codexAppServerInvocation } from './codex-plugin-dsh/adapter.js'
import { CodexRateLimitsSourceError } from './usage.js'

const DEFAULT_DISPOSE_GRACE_MS = 3_000
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

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function assertPositiveFinite(owner: string, name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${owner}: ${name} must be a positive safe integer`)
  }
}

function configuredCommand(spec: OfficialCodexRateLimitsSourceSpec): string {
  const explicit = spec.executable?.trim()
  return explicit && explicit.length > 0 ? explicit : 'codex'
}

function isUnsupportedAppServerVersion(error: Error): boolean {
  return error.message.includes('unsupported Codex App Server version')
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

    const resolveOrTimeout = async (name: string): Promise<string> => {
      const resolution = this.spec.resolveExecutable(name, env, timeoutController.signal)
      void resolution.catch(() => {})
      try {
        return await Promise.race([resolution, timeout])
      } catch (resolutionError) {
        if (timeoutController.signal.aborted) throw timeoutError
        throw new CodexRateLimitsSourceError(
          'Codex CLI is unavailable',
          'UNAVAILABLE',
          { cause: thrown(resolutionError) },
        )
      }
    }

    let executable: string
    try {
      executable = await resolveOrTimeout(command)
    } catch (resolutionError) {
      if (timer !== undefined) clearTimeout(timer)
      throw resolutionError
    }

    const batchShim = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())
    let commandInterpreter: string | undefined
    if (batchShim) {
      try {
        commandInterpreter = await resolveOrTimeout('cmd.exe')
      } catch (resolutionError) {
        if (timer !== undefined) clearTimeout(timer)
        throw resolutionError
      }
    }

    const invocation = codexAppServerInvocation(executable, env, process.platform, commandInterpreter)
    let child: SubprocessHandle
    try {
      child = this.spec.spawn({
        argv: [...invocation.argv],
        cwd: this.spec.cwd,
        // Captured, not inherited. `inherit` wrote raw vendor stderr straight to
        // the host process's own stderr, which was the one place in this package
        // where vendor-authored text reached a human unscrubbed -- credential
        // paths and network diagnostics included. Nothing reads this buffer on
        // the success path; it exists so those bytes have somewhere to go that
        // is not the operator's console.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: USAGE_STDERR_MAX_BYTES } },
        graceMs,
        env: invocation.env,
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

    let connection: CodexAppServerConnection
    try {
      connection = new CodexAppServerConnection(
        child,
        async (method) => {
          throw new Error(`codex-usage: unexpected App Server request ${JSON.stringify(method)}`)
        },
      )
    } catch (connectionError) {
      if (timer !== undefined) clearTimeout(timer)
      await disposeVendorChild(child).catch(() => {})
      throw connectionError
    }

    const protocol = (async (): Promise<unknown> => {
      try {
        await connection.initialize(timeoutController.signal)
      } catch (error) {
        const failure = thrown(error)
        if (isUnsupportedAppServerVersion(failure)) {
          // An installed-but-unsupported Codex version is an availability
          // problem, not a collection error: the source spec only maps
          // CodexRateLimitsSourceError to a status, so an ordinary Error
          // here would collapse to ERROR instead of UNAVAILABLE.
          throw new CodexRateLimitsSourceError(failure.message, 'UNAVAILABLE', { cause: failure })
        }
        throw failure
      }
      const account = await connection.request('account/read', { refreshToken: false }, timeoutController.signal)
      if (account.requiresOpenaiAuth === true && account.account == null) {
        throw new CodexRateLimitsSourceError(
          'Codex login is required; run `codex login` on the DSH host',
          'LOGIN_REQUIRED',
        )
      }
      return await connection.request('account/rateLimits/read', {}, timeoutController.signal)
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
        await connection.close()
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
