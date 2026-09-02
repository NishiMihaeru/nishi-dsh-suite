/** Owned Codex App Server process and JSONL connection. */

import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { object, thrown } from './validation.js'
import { codexVendorFailure } from './vendor-stderr.js'

/** Oldest external Codex runtime whose App Server contracts this provider is audited against. */
export const MINIMUM_CODEX_APP_SERVER_VERSION = '0.150.0'

/**
 * Whether an observed App Server version is new enough to be driven.
 *
 * A FLOOR rather than the exact pin this used to be, changed 2026-09-02. The
 * pin refused every Codex release after the audited one, which trades a
 * CERTAIN failure on every upgrade against an uncertain one. The two
 * directions are not symmetric and only one is knowable from a version: a
 * runtime too OLD to carry `experimentalApi`, `thread/inject_items` or the
 * checkpoint calls is worth refusing up front, while a runtime NEWER than the
 * audited one breaks, if it breaks at all, as a JSON-RPC error on the method
 * that changed -- loud, attributable, and not something an upper bound would
 * have caught anyway once the vendor moved inside it.
 *
 * Prerelease builds of the floor (`0.150.0-rc.1`) sort BELOW it, as semver
 * says: the audited contracts are the release's, not its candidates'. Build
 * metadata (`0.150.0+abc`) does not affect precedence and is ignored.
 *
 * See `docs/ROADMAP.md` section 3 for why Antigravity is NOT given an
 * equivalent gate.
 */
export function codexAppServerVersionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string): { readonly release: readonly number[]; readonly prerelease: boolean } => {
    const core = value.split('+', 1)[0] ?? value
    const dash = core.indexOf('-')
    const release = (dash < 0 ? core : core.slice(0, dash)).split('.').map(part => Number(part))
    return { release, prerelease: dash >= 0 }
  }
  const observed = parse(version)
  const floor = parse(minimum)
  for (let index = 0; index < 3; index += 1) {
    const left = observed.release[index] ?? 0
    const right = floor.release[index] ?? 0
    if (Number.isNaN(left) || Number.isNaN(right)) return false
    if (left !== right) return left > right
  }
  // Equal releases: a prerelease of the floor is older than the floor itself.
  return !(observed.prerelease && !floor.prerelease)
}

/** Extract the Codex package version from the initialize user-agent prefix. */
export function codexAppServerVersionFromUserAgent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const first = value.trim().split(/\s+/, 1)[0]
  if (first === undefined || first.length === 0) return undefined
  const slash = first.lastIndexOf('/')
  if (slash < 0 || slash === first.length - 1) return undefined
  const version = first.slice(slash + 1)
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : undefined
}

/** One App Server notification in arrival order. */
export interface AppServerNotification {
  readonly method: string
  readonly params: Record<string, unknown>
}

/** Handler for an App Server request that requires a client response. */
export type AppServerRequestHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>

/** Synchronous connection observations used to preserve inbound wire ordering. */
export interface AppServerConnectionObserver {
  readonly notification: (notification: AppServerNotification) => void
  readonly failure: (error: Error) => void
}

class NotificationQueue implements AsyncIterable<AppServerNotification> {
  private readonly values: AppServerNotification[] = []
  private readonly waiters: Array<PromiseWithResolvers<IteratorResult<AppServerNotification>>> = []
  private terminal: { readonly error?: Error } | undefined

  push(value: AppServerNotification): void {
    if (this.terminal !== undefined) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.values.push(value)
    else waiter.resolve({ done: false, value })
  }

  end(): void {
    this.settle({})
  }

  fail(error: Error): void {
    this.settle({ error })
  }

  private settle(terminal: { readonly error?: Error }): void {
    if (this.terminal !== undefined) return
    this.terminal = terminal
    for (const waiter of this.waiters.splice(0)) {
      if (terminal.error === undefined) waiter.resolve({ done: true, value: undefined })
      else waiter.reject(terminal.error)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AppServerNotification> {
    return {
      next: (): Promise<IteratorResult<AppServerNotification>> => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ done: false, value })
        if (this.terminal?.error !== undefined) return Promise.reject(this.terminal.error)
        if (this.terminal !== undefined) return Promise.resolve({ done: true, value: undefined })
        const waiter = Promise.withResolvers<IteratorResult<AppServerNotification>>()
        this.waiters.push(waiter)
        return waiter.promise
      },
    }
  }
}

/** One initialized or initializing App Server child. */
export class CodexAppServerConnection {
  private readonly transport: JsonRpcLineTransport
  private readonly queue = new NotificationQueue()
  private closePromise: Promise<void> | undefined
  /**
   * The App Server version this connection actually handshook, once known.
   *
   * Recorded rather than gated on beyond the floor: with no upper bound, the
   * build a turn ran against is the first thing a later reader wants and the
   * handshake discloses it for free.
   */
  appServerVersion: string | undefined

  constructor(
    private readonly child: SubprocessHandle,
    requestHandler: AppServerRequestHandler,
    private readonly observer?: AppServerConnectionObserver,
  ) {
    if (child.stdout === undefined || child.stdin === undefined) {
      throw new Error('codex-plugin-dsh: App Server subprocess requires piped stdin and stdout')
    }
    child.stdin.on?.('error', () => {})
    child.stdout.on?.('error', () => {})
    this.transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    this.transport.onRequest(requestHandler)
    this.transport.onNotification((method, params) => {
      const notification = { method, params }
      if (this.observer === undefined) this.queue.push(notification)
      else this.observer.notification(notification)
    })
    void child.done.then(
      outcome => {
        if (this.closePromise !== undefined) return
        const failure = codexVendorFailure({
          stage: 'app-server',
          stderrText: this.collectedStderrText(),
          exitCode: outcome.exitCode,
          signal: outcome.signal,
        })
        const error = new Error(`codex-plugin-dsh: App Server exited unexpectedly. ${failure.message}`, { cause: failure })
        if (this.observer === undefined) this.queue.fail(error)
        else this.observer.failure(error)
      },
      error => {
        if (this.closePromise !== undefined) return
        const failure = thrown(error)
        if (this.observer === undefined) this.queue.fail(failure)
        else this.observer.failure(failure)
      },
    )
  }

  /** Attach protocol listeners, validate the audited vendor runtime, and complete initialize. */
  async initialize(signal: AbortSignal): Promise<void> {
    this.transport.start()
    const initialized = object(await this.transport.request('initialize', {
      clientInfo: {
        name: 'codex-plugin-dsh',
        title: 'Codex Plugin for DeepSeek Harness',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    }, signal), 'initialize response')
    const version = codexAppServerVersionFromUserAgent(initialized.userAgent)
    if (version === undefined || !codexAppServerVersionAtLeast(version, MINIMUM_CODEX_APP_SERVER_VERSION)) {
      throw new Error(
        `codex-plugin-dsh: unsupported Codex App Server version ${JSON.stringify(version ?? initialized.userAgent)}; requires ${MINIMUM_CODEX_APP_SERVER_VERSION} or newer`,
      )
    }
    // Recorded and NOT gated on: a turn that fails against a newer runtime
    // should carry the build it ran on rather than have it reconstructed.
    this.appServerVersion = version
    this.transport.notify('initialized', {})
    await this.transport.flush()
  }

  /** Send one typed-by-caller App Server request. */
  async request(method: string, params: object, signal: AbortSignal): Promise<Record<string, unknown>> {
    return object(await this.transport.request(method, params, signal), `${method} response`)
  }

  /** Send a best-effort interrupt for an active turn. */
  interrupt(threadId: string, turnId: string): void {
    if (this.closePromise !== undefined) return
    void this.transport.request('turn/interrupt', { threadId, turnId }).catch(() => {})
  }

  /** Notifications emitted by this single-operation connection. */
  notifications(): AsyncIterable<AppServerNotification> {
    return this.queue
  }

  /** Terminate the managed process tree and make every caller wait until it is gone. */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    const closing = this.finishClose()
    this.closePromise = closing
    return closing
  }

  private async finishClose(): Promise<void> {
    this.queue.end()
    this.transport.close()
    try {
      this.child.stdin?.end()
    } catch {
      // Concurrent process closure leaves tree termination below authoritative.
    }
    this.child.terminate()
    await this.child.waitForExit()
    await this.child.done.catch(() => {})
  }

  private collectedStderrText(): string | undefined {
    return this.child.collected.stderr?.readFrom(0).text
  }
}
