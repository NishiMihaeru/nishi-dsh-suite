/**
 * Quota read the way the vendor publishes it: `agy -p "/usage"`.
 *
 * This module exists because finding 5 of `docs/verification/agy-cli-contract.md`
 * was wrong. It concluded that no published channel served quota headless,
 * and everything downstream of it followed from that conclusion: a private
 * RPC of the vendor's language server, reached by walking `/proc` for a
 * child's descendants, matching socket inodes against `/proc/net/tcp`, and a
 * PID-scoped trust boundary invented so that reading a loopback port nobody
 * documented could be defended at all. Roughly 800 lines, every one of them
 * resting on rows the inventory could only mark observed-only.
 *
 * Finding 17 probed the door finding 10 had left unopened, and it answers.
 * Measured on real `agy 1.1.25`:
 *
 *   - `agy -p "/usage" --output-format json` exits `0` with `status:
 *     "SUCCESS"`, `conversation_id: ""`, `num_turns: 0` and **every usage
 *     counter at zero** -- the read is free, not merely cheap;
 *   - the payload arrives under `command`: `{name: "usage", data: {groups:
 *     [{name, buckets: [{id, name, window, remaining_fraction,
 *     reset_time}]}]}}`, which is every field this package projects, at full
 *     float precision, with the pool name given rather than guessed;
 *   - no conversation is created: the vendor's `conversations/` directory
 *     held 1395 entries before and after.
 *
 * Two properties of the old path are deliberately kept, because they were
 * right about the capability rather than about the transport.
 *
 * **A bucket with no finite fraction is skipped, and a reading with no
 * surviving bucket is an absence rather than a zero.** After an upstream
 * failure the vendor can answer with buckets carrying no remaining figure at
 * all, persistently, and inventing headroom from a missing field is the one
 * failure mode a quota display must not have.
 *
 * **The reading can still be confidently wrong.** A quota summary can report
 * headroom while generation returns 429 (`CLIProxyAPI` issue 1015, recorded
 * in `docs/verification/prior-art.md`). Publishing the channel does not make
 * the number true; it makes the number documented.
 *
 * What changes is the cost model. The old warm path was nearly free because
 * it read a socket a turn was already paying for; this one is a subprocess
 * every time, measured at a ~3.2 s median against the old cold path's ~2.2 s.
 * So the rate limit and single-flight the cold harvest needed are kept here
 * rather than dropped: a usage panel refreshes far more often than a quota
 * bucket moves, and a refresh loop must not become a spawn loop.
 *
 * @module nishi-dsh-antigravity/usage-command
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { record, resolveVendorInvocation } from './agy-vendor.js'
import {
  AntigravityUsageSourceError,
  type AntigravityNumericUsageObservation,
  type AntigravityNumericWindowObservation,
  type AntigravityUsageCapabilitySource,
} from './usage.js'

/** Same override key the old quota path used; a Windows shim still needs one. */
const WINDOWS_EXECUTABLE_ENV = 'DSH_ANTIGRAVITY_QUOTA_CLI_EXECUTABLE'

/**
 * Ceiling on the whole read, spawn included.
 *
 * A person is waiting on this, so it is a bound on their wait rather than a
 * generous allowance: measured at a ~3.2 s median, and 20 s is far enough
 * beyond that to survive a cold page cache without becoming an unexplained
 * hang.
 */
const USAGE_COMMAND_DEADLINE_MS = 20_000

/** Vendor output is a few kilobytes of JSON; anything past this is not it. */
const USAGE_COMMAND_MAX_BYTES = 64_000

/**
 * Floor on how often a process may be spent, successful or not.
 *
 * Not a cache of correctness -- the last good reading is served inside the
 * window, which is what makes a fast refresh cheap instead of stale-looking.
 */
const USAGE_COMMAND_MIN_INTERVAL_MS = 60_000

export interface AntigravityUsageCommandConfig {
  readonly executable: string
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  /** Overridable for tests; never in production. */
  readonly deadlineMs?: number
  readonly minIntervalMs?: number
  readonly now?: () => number
}

function windowKindOf(window: unknown): AntigravityNumericWindowObservation['windowKind'] {
  if (window === 'weekly') return 'WEEKLY'
  if (window === '5h') return 'SHORT'
  return 'OTHER'
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * Turn one `/usage` payload into windows, dropping any bucket that does not
 * carry a finite fraction.
 *
 * The vendor's own group name becomes the pool, which is the one thing this
 * transport gives that the RPC never did: the old path had to strip cadence
 * words off a window label and fall back to a bucket id, so `gemini-weekly`
 * would have displayed as "gemini" where the vendor says "Gemini Models".
 *
 * @param payload - The parsed `command.data` object.
 * @returns Windows in vendor order, possibly empty.
 */
export function usageWindowsFrom(payload: unknown): AntigravityNumericWindowObservation[] {
  const data = record(payload)
  const groups = data?.groups
  if (!Array.isArray(groups)) return []
  const windows: AntigravityNumericWindowObservation[] = []
  for (const rawGroup of groups) {
    const group = record(rawGroup)
    if (!group) continue
    const poolLabel = typeof group.name === 'string' && group.name.trim().length > 0
      ? group.name.trim()
      : undefined
    const buckets = group.buckets
    if (!Array.isArray(buckets)) continue
    for (const rawBucket of buckets) {
      const bucket = record(rawBucket)
      if (!bucket) continue
      const fraction = bucket.remaining_fraction
      // The skip that keeps an upstream failure honest: no finite fraction,
      // no window, and a reading of no windows is reported as unavailable
      // rather than as full headroom.
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) continue
      const remainingPercent = Math.min(100, Math.max(0, fraction * 100))
      const id = typeof bucket.id === 'string' && bucket.id.trim().length > 0
        ? bucket.id.trim()
        : undefined
      const label = typeof bucket.name === 'string' ? bucket.name : ''
      const resetsAtMs = typeof bucket.reset_time === 'string'
        ? Date.parse(bucket.reset_time)
        : Number.NaN
      windows.push({
        windowKind: windowKindOf(bucket.window),
        label,
        scope: 'BUCKET',
        ...(id === undefined ? {} : { scopeId: id }),
        usedPercent: 100 - remainingPercent,
        remainingPercent,
        ...(Number.isFinite(resetsAtMs) ? { resetsAtMs } : {}),
        ...(poolLabel === undefined ? {} : { poolLabel, poolId: slug(poolLabel) }),
      })
    }
  }
  return windows
}

/** The `command.data` of a `/usage` reply, or `undefined` if this is not one. */
function usagePayload(stdout: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const envelope = record(parsed)
  if (!envelope || envelope.status !== 'SUCCESS') return undefined
  const command = record(envelope.command)
  if (!command || command.name !== 'usage') return undefined
  return command.data
}

/**
 * The quota source for one provider registration.
 *
 * Single-flighted so concurrent panel refreshes share one process, and
 * rate-limited so a refresh loop cannot become a spawn loop. Inside the
 * window the last good reading is served; with no reading yet, the caller
 * gets the same honest unavailability it would get from a failed read.
 */
export class AntigravityUsageCommandSource implements AntigravityUsageCapabilitySource {
  private inFlight: Promise<AntigravityNumericUsageObservation | undefined> | undefined
  private lastAttemptAtMs: number | undefined
  private last: AntigravityNumericUsageObservation | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: AntigravityUsageCommandConfig,
  ) {}

  async read(): Promise<AntigravityNumericUsageObservation> {
    const observation = await this.observe()
    if (observation) return observation
    throw new AntigravityUsageSourceError(
      'No Antigravity quota reading available: `agy -p "/usage"` produced no bucket carrying a '
      + 'remaining fraction.',
      'UNAVAILABLE',
    )
  }

  private async observe(): Promise<AntigravityNumericUsageObservation | undefined> {
    if (this.inFlight) return await this.inFlight
    const now = this.config.now ?? Date.now
    const minIntervalMs = this.config.minIntervalMs ?? USAGE_COMMAND_MIN_INTERVAL_MS
    const since = this.lastAttemptAtMs === undefined ? undefined : now() - this.lastAttemptAtMs
    if (since !== undefined && since >= 0 && since < minIntervalMs) return this.last
    this.lastAttemptAtMs = now()
    this.inFlight = this.run()
    try {
      const observation = await this.inFlight
      if (observation) this.last = observation
      return observation ?? this.last
    } finally {
      this.inFlight = undefined
    }
  }

  private async run(): Promise<AntigravityNumericUsageObservation | undefined> {
    const controller = new AbortController()
    const deadlineMs = this.config.deadlineMs ?? USAGE_COMMAND_DEADLINE_MS
    const deadline = setTimeout(() => { controller.abort() }, deadlineMs)
    deadline.unref?.()
    let root: string | undefined
    try {
      root = await mkdtemp(join(tmpdir(), 'dsh-antigravity-usage-'))
      const invocation = await resolveVendorInvocation(
        this.ctx,
        this.config.executable,
        this.config.env,
        // `-p` takes its prompt as the next argument, which is only safe
        // because this is an argv array: on a shell command line the flag
        // swallows whatever follows it, and the vendor says so by name.
        ['-p', '/usage', '--output-format', 'json'],
        controller.signal,
        WINDOWS_EXECUTABLE_ENV,
      )
      const child = this.ctx.subprocess.spawn({
        argv: [...invocation.argv],
        cwd: root,
        // No stdin at all: a slash command is answered by the CLI without an
        // agent turn, and nothing here should be able to start one.
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: USAGE_COMMAND_MAX_BYTES },
          stderr: { maxBytes: 4096 },
        },
        graceMs: this.config.disposeGraceMs,
        signal: controller.signal,
      })
      try {
        await child.waitForExit(controller.signal)
        const stdout = child.collected.stdout?.readFrom(0).text ?? ''
        const windows = usageWindowsFrom(usagePayload(stdout))
        if (windows.length === 0) return undefined
        return { kind: 'NUMERIC_USAGE_AVAILABLE', windows, sourceKind: 'usage-command' }
      } finally {
        child.terminate()
        await child.waitForExit(AbortSignal.timeout(this.config.disposeGraceMs)).catch(() => false)
      }
    } catch {
      // A failed read is indistinguishable, to the caller, from one that was
      // never possible, and the caller already has an honest answer for that.
      // Vendor stderr is never inspected here, so nothing of it can leak.
      return undefined
    } finally {
      clearTimeout(deadline)
      if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(() => {})
    }
  }
}
