/**
 * One live `agy` child driven across many DSH steps.
 *
 * The vendor's `--input-format stream-json` "reads one NDJSON message per
 * line from stdin and runs a turn for each" (agy `--help`), so a single
 * child can serve every step of a DSH turn -- and every turn of a DSH
 * session -- instead of being spawned and killed per step.
 *
 * That matters for cost, not tidiness. A fresh child starts a fresh vendor
 * conversation, and a fresh conversation never hits the vendor's prefix
 * cache: measured against real `agy 1.1.22`, a second turn inside one child
 * read 20418 of its 23496-token prefix from cache and paid for 3288 new
 * tokens, while the same exchange split across two children paid full price
 * twice. It also gives the model its own prior replies as real assistant
 * turns rather than as JSON quoted back at it inside a user message.
 *
 * The process is deliberately dumb about DSH policy: it writes a line, waits
 * for that line's `result` event, and hands back the events it saw in
 * between. Deciding whether a live child may serve the next request at all
 * belongs to the adapter, which owns the history it would have to match.
 *
 * @module nishi-dsh-antigravity/agy-session
 */

import { createInterface, type Interface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { record } from './agy-vendor.js'
import { antigravityVendorFailure } from './vendor-stderr.js'

/** The vendor's `result` payload for one turn; fields stay `unknown` until validated. */
export interface AgyTurnResult {
  readonly conversation_id?: unknown
  readonly status?: unknown
  readonly response?: unknown
  readonly error?: unknown
  readonly structured_output?: unknown
  readonly usage?: unknown
}

/** One turn's result together with the vendor events observed while producing it. */
export interface AgyTurnOutcome {
  readonly result: AgyTurnResult
  readonly events: readonly Record<string, unknown>[]
}

/** Everything needed to spawn one `agy` child, resolved by the caller. */
export interface AgyProcessSpec {
  readonly argv: readonly string[]
  readonly env: Record<string, string>
  readonly cwd: string
  readonly graceMs: number
  readonly stderrMaxBytes: number
}

/**
 * A live `agy` child that runs one turn per NDJSON line written to its stdin.
 *
 * One turn at a time: {@link turn} rejects rather than queueing if a turn is
 * already in flight, because a second concurrent request for one DSH session
 * means the caller lost track of its own turn boundaries, and interleaving
 * two conversations in one vendor thread would corrupt both.
 */
export class AgyTurnProcess {
  private readonly lines: Interface
  private events: Record<string, unknown>[] = []
  /**
   * Results seen but not yet claimed by a `turn()` caller.
   *
   * The vendor never speaks unprompted, so in production this holds at most
   * the result of a line whose caller has already gone away. It exists
   * because `start()` and `turn()` are separate awaited calls: a child that
   * answers between the two would otherwise have its answer dropped on the
   * floor and then be declared dead when its stdout closed.
   */
  private buffered: AgyTurnOutcome[] = []
  private pending: {
    readonly resolve: (outcome: AgyTurnOutcome) => void
    readonly reject: (error: unknown) => void
  } | undefined
  private dead: Error | undefined
  private busy = false
  /** Vendor stderr observed when the child died, for effort-support diagnosis. */
  private deathStderr: string | undefined

  private constructor(
    private readonly child: SubprocessHandle,
    private readonly graceMs: number,
  ) {
    const stdout = child.stdout
    /* v8 ignore next -- start() rejects before constructing when a pipe is missing. */
    if (!stdout) throw new LlmError('Antigravity subprocess did not expose stdout', 'ANTIGRAVITY_CLI')
    stdout.setEncoding('utf8')
    stdout.on('error', () => {})
    child.stdin?.on('error', () => {})
    this.lines = createInterface({ input: stdout, crlfDelay: Infinity })
    this.lines.on('line', line => { this.onLine(line) })
    this.lines.on('close', () => { this.onClose() })
  }

  /** PID of the live child, for the opportunistic quota harvest. */
  get pid(): SubprocessHandle['pid'] {
    return this.child.pid
  }

  /** Whether this child is still able to serve another turn. */
  get alive(): boolean {
    return this.dead === undefined
  }

  /** Vendor stderr collected when the child died, empty until it does. */
  get stderrAtDeath(): string {
    return this.deathStderr ?? ''
  }

  /**
   * Spawn one `agy` child and wrap it.
   * @param ctx - Provider context owning the subprocess service.
   * @param spec - Fully resolved argv, environment and limits.
   * @param signal - Cancels the spawn and terminates the child when aborted.
   * @returns The wrapped live child.
   */
  static async start(ctx: Context, spec: AgyProcessSpec, signal: AbortSignal): Promise<AgyTurnProcess> {
    const child = ctx.subprocess.spawn({
      argv: [...spec.argv],
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: spec.stderrMaxBytes },
      },
      graceMs: spec.graceMs,
      signal,
      env: { ...spec.env },
    })
    if (!child.stdin || !child.stdout) {
      child.terminate()
      throw new LlmError(
        'Antigravity subprocess did not expose required stdio pipes',
        'ANTIGRAVITY_CLI',
      )
    }
    return new AgyTurnProcess(child, spec.graceMs)
  }

  /**
   * Run one turn: write a single NDJSON line and await that line's `result`.
   *
   * A failure of any kind -- vendor exit, protocol violation, timeout,
   * caller abort -- kills the child and marks it dead. There is no way to
   * learn how much of a half-run turn the vendor kept, so the conversation
   * is abandoned rather than reused on a guess; the caller rebuilds from
   * DSH's own history, which is the authoritative copy.
   *
   * @param payload - One NDJSON line, newline included.
   * @param signal - Turn cancellation, already combined with any timeout.
   * @returns The turn's result and the events observed while producing it.
   */
  async turn(payload: string, signal: AbortSignal): Promise<AgyTurnOutcome> {
    if (this.dead && this.buffered.length === 0) throw this.dead
    if (this.busy) {
      throw new LlmError(
        'Antigravity received a second concurrent request for one DSH session',
        'ANTIGRAVITY_PROTOCOL',
      )
    }
    signal.throwIfAborted()
    this.busy = true
    try {
      return await new Promise<AgyTurnOutcome>((resolve, reject) => {
        const onAbort = (): void => {
          this.fail(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        this.pending = {
          resolve: outcome => {
            signal.removeEventListener('abort', onAbort)
            resolve(outcome)
          },
          reject: error => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          },
        }
        this.child.stdin?.write(payload, () => {})
        this.settle()
      })
    } finally {
      this.busy = false
    }
  }

  /** Terminate the child and settle any in-flight turn. Idempotent. */
  async close(): Promise<void> {
    this.fail(new LlmError('Antigravity session process was closed', 'ANTIGRAVITY_CLI'))
    try { this.child.stdin?.end() } catch {}
    this.child.terminate()
    await this.child.waitForExit(AbortSignal.timeout(this.graceMs)).catch(() => false)
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      this.fail(new LlmError(
        `Antigravity emitted non-JSON stdout in stream-json mode: ${trimmed}`,
        'ANTIGRAVITY_PROTOCOL',
      ))
      return
    }
    const row = record(event)
    if (!row) return
    this.events.push(row)
    if (row.event !== 'result') return
    this.buffered.push({
      result: (record(row.result) ?? {}) as AgyTurnResult,
      events: this.events,
    })
    // The outcome keeps the array it was built with; the next turn's events
    // accumulate into a fresh one.
    this.events = []
    this.settle()
  }

  /** Hand one buffered result to a waiting turn, if both exist. */
  private settle(): void {
    const pending = this.pending
    if (pending === undefined) return
    const outcome = this.buffered.shift()
    if (outcome === undefined) return
    this.pending = undefined
    pending.resolve(outcome)
  }

  private onClose(): void {
    if (this.dead) return
    void this.child.done.then(outcome => {
      const stderr = this.child.collected.stderr?.readFrom(0).text ?? ''
      const failure = antigravityVendorFailure({
        stage: 'turn',
        stderrText: stderr,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
      })
      this.fail(new LlmError(
        `Antigravity CLI exited before a result event. ${failure.message}`,
        'ANTIGRAVITY_CLI',
        { cause: failure },
      ), stderr)
    }, () => {
      this.fail(new LlmError('Antigravity CLI exited before a result event.', 'ANTIGRAVITY_CLI'))
    })
  }

  /**
   * Mark the child unusable and settle any in-flight turn with the reason.
   *
   * The first reason wins: a caller abort that kills the child would
   * otherwise be overwritten by the exit it causes, and the caller's own
   * cancellation is the more truthful answer.
   */
  private fail(error: Error, stderrText?: string): void {
    if (!this.dead) {
      this.dead = error
      this.deathStderr = stderrText
      this.child.terminate()
    }
    // A result already in hand outranks the death that followed it: the
    // child answering and then exiting is a completed turn, not a failure.
    this.settle()
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    pending.reject(this.dead)
  }
}
