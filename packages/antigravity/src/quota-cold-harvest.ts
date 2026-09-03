/**
 * One `agy` child spawned for no purpose but to be asked its quota, then
 * disposed.
 *
 * The opportunistic harvest (`quota-harvest-cache.ts`) reads the child a turn
 * was already paying for, which left a real hole: **no quota number existed
 * until this plugin had run a turn**, so a fresh session showed an honest but
 * empty row. That was recorded as the cost of narrowing the harvest to this
 * package's own child, and it turns out not to be necessary.
 *
 * Measured on real `agy 1.1.25`, through this package's own
 * `createHostPlatformDiscovery()` and `AntigravityQuotaHarvestCache` rather
 * than hand-rolled HTTP, from a scratch directory, with **not one byte
 * written to the child's stdin** (`docs/verification/agy-cli-contract.md`,
 * findings 12 and 14):
 *
 *   - two loopback listeners appear on the child's own pid at **+261 ms**
 *     (`--sandbox`: +255 ms), long before any turn could exist;
 *   - the real payload -- the same two groups and four buckets the live suite
 *     records -- arrives at **+1.8 s**, after ~1.5 s of the harvest's own
 *     retrying, because the server answers before its login does;
 *   - **nothing is billed**: no `init`, no `result`, zero bytes on stdout
 *     while the reading is taken, and no file in the vendor's
 *     `conversations/`;
 *   - disposal through the ordinary grace path (end stdin, terminate, wait)
 *     leaves the vendor's `crashes/` directory **empty**, where a `SIGKILL`
 *     leaves an empty crash log behind.
 *
 * Three consequences are load-bearing rather than incidental, and each is a
 * line of code below:
 *
 *   1. **poll, do not read once.** The listener exists a second and a half
 *      before the answer does. The opportunistic path's five attempts are
 *      sized for a child that has already been running a turn; a cold child
 *      needs its own, wider window.
 *   2. **the two ports are not interchangeable.** One speaks HTTPS only and
 *      the other HTTP only, so the cache's http-then-https attempt per port
 *      is load-bearing rather than defensive.
 *   3. **zero tokens is not zero residue.** A cold start still writes the
 *      ordinary vendor state any run writes (`cache/onboarding.json`,
 *      `updater/update_status.json`, a `log/cli-*.log`, one `implicit/*.pb`),
 *      so this is cheap rather than free, and is therefore single-flighted
 *      and rate-limited instead of run per refresh.
 *
 * A cold reading is also not a worse reading, which is the question that
 * decided whether this could ship at all: the live suite runs both arms
 * against one account minutes apart and they agree to the second decimal
 * (`usedPercent` 1.03 warm, 1.03 cold). What varies is the RPC's own
 * content -- a window roll moves the figure, and after an upstream failure
 * every bucket can come back with no `remaining` field at all, before AND
 * after a completed turn. The parser's skip-and-throw on a missing fraction
 * is what turns that into an honest absence instead of invented headroom.
 *
 * The reading itself carries a caveat that no amount of polling fixes and
 * that belongs with the capability rather than with this module: a quota
 * summary can report headroom while generation returns 429 (`CLIProxyAPI`
 * issue 1015, recorded in `docs/verification/prior-art.md`). This capability
 * can be confidently wrong, and says so.
 *
 * @module nishi-dsh-antigravity/quota-cold-harvest
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveVendorInvocation } from './agy-vendor.js'
import type { AntigravityQuotaHarvestCache } from './quota-harvest-cache.js'
import type { AntigravityNumericUsageObservation } from './usage.js'

/** Same override key the primary route uses; a Windows shim needs it here too. */
const WINDOWS_EXECUTABLE_ENV = 'DSH_ANTIGRAVITY_QUOTA_CLI_EXECUTABLE'

/**
 * How long the whole cold harvest may take, spawn included.
 *
 * A usage read is something a person is waiting on, so this is a ceiling on
 * their wait rather than a generous allowance: measured, the reading lands at
 * ~1.8 s, and 15 s is far enough beyond that to survive a slow disk or a cold
 * page cache without ever becoming an unexplained hang.
 */
const COLD_HARVEST_DEADLINE_MS = 15_000

/**
 * Attempts inside that deadline, spaced by this delay.
 *
 * 40 x 250 ms covers ten seconds of polling, against a measured 1.5 s. The
 * loop stops at the first reading, so the width costs nothing in the ordinary
 * case and only buys patience in the slow one.
 */
const COLD_HARVEST_MAX_ATTEMPTS = 40
const COLD_HARVEST_RETRY_DELAY_MS = 250

/**
 * Minimum gap between cold harvests, successful or not.
 *
 * A cold start is a real process and real vendor-state writes, and a usage
 * panel can refresh far more often than a quota bucket moves. This is not a
 * cache -- the cache is `AntigravityQuotaHarvestCache`, with its own
 * staleness budget -- but a floor on how often this module is willing to
 * spend a process, so a refresh loop cannot turn into a spawn loop.
 */
const COLD_HARVEST_MIN_INTERVAL_MS = 60_000

export interface AntigravityColdQuotaHarvestConfig {
  readonly executable: string
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  /** Overridable for tests; never in production. */
  readonly deadlineMs?: number
  readonly minIntervalMs?: number
  readonly now?: () => number
}

/** One attempt's outcome, for the caller that decides whether to keep waiting. */
export type AntigravityColdQuotaHarvest = () => Promise<AntigravityNumericUsageObservation | undefined>

/**
 * Build the cold-harvest function for one provider registration.
 *
 * Single-flighted: concurrent callers share one child rather than racing two
 * onto the same listener discovery. Rate-limited: a caller arriving inside
 * {@link COLD_HARVEST_MIN_INTERVAL_MS} of the last attempt gets whatever the
 * cache holds instead of a second process. Never throws -- a cold harvest
 * that fails is indistinguishable, to its caller, from one that was never
 * possible, and the caller already has an honest answer for that.
 */
export function createColdQuotaHarvest(
  ctx: Context,
  config: AntigravityColdQuotaHarvestConfig,
  cache: AntigravityQuotaHarvestCache,
): AntigravityColdQuotaHarvest {
  const now = config.now ?? Date.now
  const deadlineMs = config.deadlineMs ?? COLD_HARVEST_DEADLINE_MS
  const minIntervalMs = config.minIntervalMs ?? COLD_HARVEST_MIN_INTERVAL_MS
  let inFlight: Promise<AntigravityNumericUsageObservation | undefined> | undefined
  let lastAttemptAtMs: number | undefined

  async function run(): Promise<AntigravityNumericUsageObservation | undefined> {
    const controller = new AbortController()
    const deadline = setTimeout(() => { controller.abort() }, deadlineMs)
    deadline.unref?.()
    let root: string | undefined
    try {
      root = await mkdtemp(join(tmpdir(), 'dsh-antigravity-quota-'))
      const invocation = await resolveVendorInvocation(
        ctx,
        config.executable,
        config.env,
        // The minimal shape the probe verified. No `--json-schema`, no
        // `--agent`, no `--model`: none of them affect the listener, and each
        // would be one more vendor surface a reading nobody asked a question
        // for depends on.
        ['--input-format', 'stream-json', '--output-format', 'stream-json'],
        controller.signal,
        WINDOWS_EXECUTABLE_ENV,
      )
      const child = ctx.subprocess.spawn({
        argv: [...invocation.argv],
        cwd: root,
        // stdin is a pipe that is never written to. That is the whole
        // guarantee that nothing is billed: the vendor runs a turn per line
        // of stdin, and there are no lines.
        // Bounded collection rather than a pipe nobody reads: the child
        // writes a couple of hundred bytes when its stdin closes, and an
        // unread pipe would leave that unconsumed at teardown.
        stdio: { stdin: 'pipe', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
        graceMs: config.disposeGraceMs,
        signal: controller.signal,
      })
      try {
        const pid = child.pid
        if (pid === undefined) return undefined
        await cache.harvest(pid, {
          maxAttempts: COLD_HARVEST_MAX_ATTEMPTS,
          retryDelayMs: COLD_HARVEST_RETRY_DELAY_MS,
          signal: controller.signal,
        })
        return cache.read()
      } finally {
        // The grace path, in the order the probe verified leaves no crash
        // log: close stdin so the vendor sees its input end, then let the
        // subprocess service escalate, then wait for it to be gone before
        // removing the directory it was running in.
        try { child.stdin?.end() } catch { /* already gone */ }
        child.terminate()
        await child.waitForExit(AbortSignal.timeout(config.disposeGraceMs)).catch(() => false)
      }
    } catch {
      // A cold harvest is pure upside; its failure must not become visible
      // as anything other than the absence of a number.
      return undefined
    } finally {
      clearTimeout(deadline)
      if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(() => {})
    }
  }

  return async function coldHarvest(): Promise<AntigravityNumericUsageObservation | undefined> {
    if (inFlight) return await inFlight
    const since = lastAttemptAtMs === undefined ? undefined : now() - lastAttemptAtMs
    if (since !== undefined && since >= 0 && since < minIntervalMs) return cache.read()
    lastAttemptAtMs = now()
    inFlight = run()
    try {
      return await inFlight
    } finally {
      inFlight = undefined
    }
  }
}
