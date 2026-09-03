/**
 * Opportunistic quota harvest from this provider's own `agy` child process.
 *
 * `HostAntigravityLocalUsageSource` (usage-source.ts) finds quota by scanning
 * *every* process on the machine for one that looks like a running
 * Antigravity IDE/APP/agy and matches its command line -- and only succeeds
 * when such a process happens to be running independently of this plugin.
 * That leaves usage reporting UNAVAILABLE in the (very common) case where
 * nothing else Antigravity-branded is open: just this CLI plugin talking to
 * its own `agy` child.
 *
 * But this package already spawns an `agy` child for every primary turn
 * (`runTurn` in antigravity-primary.ts), and while that turn is in flight the
 * child's own language server listens on a loopback port serving the same
 * `RetrieveUserQuotaSummary` RPC used above -- for free, since the turn is
 * happening anyway. This module harvests that reading opportunistically and
 * caches it for the usage collector to serve as a fallback when live
 * discovery finds nothing.
 *
 * Security note -- this is a real improvement over the existing discovery
 * path, not just a shortcut: resolving listening ports from a PID is done
 * here ONLY for the PID this package itself spawned (sourced from
 * `SubprocessHandle.pid`, passed in by the caller). This module never scans
 * `/proc` (or the Windows/macOS equivalents) for *other* processes' command
 * lines the way `HostAntigravityLocalUsageSource.discoverCandidates()` does
 * to find a candidate to trust. A PID we created ourselves is safe to probe
 * for "what ports does my own child have open"; a PID or command line
 * recovered by scanning the whole process table is a different, weaker trust
 * boundary. `discoverListeners(pid)` (reused from usage-source.ts via
 * `createHostPlatformDiscovery()`) only ever inspects the sockets owned by
 * the one given pid, so that half of the existing machinery is exactly what
 * this module needs and nothing more.
 *
 * @module nishi-dsh-antigravity/quota-harvest-cache
 */
import {
  ANTIGRAVITY_METADATA_BODY,
  createDefaultTransport,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  parseRetrieveUserQuotaSummary,
  type AntigravityListener,
  type AntigravityRequestTransport,
} from './usage-source.js'
import type { AntigravityColdQuotaHarvest } from './quota-cold-harvest.js'
import {
  AntigravityUsageSourceError,
  type AntigravityNumericUsageObservation,
  type AntigravityObservation,
  type AntigravityUsageCapabilitySource,
} from './usage.js'

/**
 * How long a harvested reading stays valid before the cache refuses to serve
 * it. Chosen relative to Antigravity's own shortest quota cadence (the
 * "session" bucket resets roughly every 5 hours, per `classifyCadence` in
 * usage-source.ts): 15 minutes is short enough that a served number still
 * describes "recently", not "sometime this session", while being long enough
 * to survive the ordinary gap between turns in a back-and-forth
 * conversation -- so the fallback is not useless the instant the harvesting
 * turn finishes. This is a deliberate choice, not a borrowed default: a
 * *live* read (what `HostAntigravityLocalUsageSource` returns when it
 * succeeds) has no staleness question at all, which is exactly why live
 * discovery must keep winning whenever it finds anything.
 */
export const DEFAULT_QUOTA_HARVEST_STALE_AFTER_MS = 15 * 60_000

/**
 * Attempts made per harvest call, spaced by `retryDelayMs`, to cover the
 * short window between "child spawned" and "child's language server is
 * actually listening". Kept small: this entire loop runs in the background
 * and must never be relied on to make a turn's own timing correct, so a few
 * hundred milliseconds of best-effort retrying is the right order of
 * magnitude, not an open-ended poll.
 */
const DEFAULT_HARVEST_MAX_ATTEMPTS = 5
const DEFAULT_HARVEST_RETRY_DELAY_MS = 250

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    // Never let a background retry timer keep the process alive.
    timer.unref?.()
  })
}

export interface AntigravityQuotaHarvestConfig {
  /**
   * Resolves the loopback listeners for one PID this package spawned itself.
   * MUST NOT scan or classify other processes -- see the module doc.
   */
  readonly discoverListeners: (pid: number) => Promise<readonly AntigravityListener[]>
  readonly requestTransport?: AntigravityRequestTransport
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly staleAfterMs?: number
  readonly maxAttempts?: number
  readonly retryDelayMs?: number
  readonly delay?: (ms: number) => Promise<void>
  readonly now?: () => number
}

/**
 * Per-call widening of the retry window, for a caller that awaits the harvest
 * rather than firing it and forgetting it.
 */
export interface AntigravityHarvestOverrides {
  readonly maxAttempts?: number
  readonly retryDelayMs?: number
  /** Cuts the loop between attempts when the caller's own deadline fires. */
  readonly signal?: AbortSignal
}

interface CachedQuotaObservation {
  readonly observation: AntigravityNumericUsageObservation
  readonly capturedAtMs: number
}

/**
 * Caches at most one quota reading harvested from this plugin instance's own
 * `agy` child. Constructed once per `apply()` call in index.ts and closed
 * over by both the model adapter (which feeds it) and the usage collector
 * (which reads it as a fallback) -- deliberately not a module-level
 * singleton, so two independent plugin instances (e.g. two `apply()` calls
 * across separate tests, or if this provider were ever registered twice)
 * never share cached quota data.
 */
export class AntigravityQuotaHarvestCache {
  private cached: CachedQuotaObservation | undefined
  private readonly requestTransport: AntigravityRequestTransport
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly staleAfterMs: number
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private readonly delay: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(private readonly config: AntigravityQuotaHarvestConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    this.requestTransport = config.requestTransport ?? createDefaultTransport(this.timeoutMs, this.maxResponseBytes)
    this.staleAfterMs = config.staleAfterMs ?? DEFAULT_QUOTA_HARVEST_STALE_AFTER_MS
    this.maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_HARVEST_MAX_ATTEMPTS)
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_HARVEST_RETRY_DELAY_MS
    this.delay = config.delay ?? defaultDelay
    this.now = config.now ?? Date.now
  }

  /**
   * Best-effort harvest from `pid`'s own loopback listeners.
   *
   * This method never throws and never rejects: every failure mode --
   * listener discovery erroring, no listeners yet, connection refused, a
   * non-200 status, malformed JSON, a request timeout -- is swallowed
   * internally. Callers MUST treat this as fire-and-forget
   * (`void cache.harvest(pid)`), never `await` it from turn control flow:
   * that is what guarantees a harvest attempt can never delay, block,
   * cancel, or fail a turn. The retry loop below exists only to widen the
   * chance of catching the child's listening window; it is bounded and
   * backgrounded, not something any caller waits on.
   *
   * `overrides` widens that window for the one caller who legitimately does
   * wait: the cold harvest, which spawns a child for this reading alone and
   * has to poll for the ~1.5 s the vendor's server answers before its login
   * does (`quota-cold-harvest.ts`). It stays an override rather than a new
   * default because the opportunistic caller must NOT start polling a turn's
   * child for ten seconds.
   */
  async harvest(pid: number, overrides?: AntigravityHarvestOverrides): Promise<void> {
    const maxAttempts = Math.max(1, overrides?.maxAttempts ?? this.maxAttempts)
    const retryDelayMs = overrides?.retryDelayMs ?? this.retryDelayMs
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (overrides?.signal?.aborted === true) return
        if (attempt > 0) await this.delay(retryDelayMs)
        let listeners: readonly AntigravityListener[]
        try {
          listeners = await this.config.discoverListeners(pid)
        } catch {
          continue
        }
        for (const listener of listeners) {
          const observation = await this.tryFetch(listener)
          if (observation) {
            this.cached = { observation, capturedAtMs: this.now() }
            return
          }
        }
      }
    } catch {
      // Swallowed by design -- see the method doc. A harvest is pure
      // upside for usage reporting; nothing about its failure may become
      // visible anywhere else, including as an unhandled rejection.
    }
  }

  private async tryFetch(listener: AntigravityListener): Promise<AntigravityNumericUsageObservation | null> {
    const host = listener.host === '::1' ? '[::1]' : listener.host
    for (const transport of ['http', 'https'] as const) {
      try {
        const res = await this.requestTransport(
          `${transport}://${host}:${listener.port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
            body: ANTIGRAVITY_METADATA_BODY,
            timeoutMs: this.timeoutMs,
            maxResponseBytes: this.maxResponseBytes,
          },
        )
        if (res.status !== 200) continue
        return parseRetrieveUserQuotaSummary(JSON.parse(res.body))
      } catch {
        continue
      }
    }
    return null
  }

  /**
   * Returns the cached observation if one exists and is still within its
   * staleness budget, else `undefined`. A harvested reading is a past
   * reading taken during some earlier turn, never a live one -- this is
   * what keeps that distinction honest instead of silently presenting an
   * old number as current.
   */
  read(): AntigravityNumericUsageObservation | undefined {
    if (!this.cached) return undefined
    const age = this.now() - this.cached.capturedAtMs
    if (age < 0 || age > this.staleAfterMs) return undefined
    return this.cached.observation
  }
}

/**
 * Wraps the live-discovery source (`HostAntigravityLocalUsageSource`) so the
 * usage collector falls back to this plugin's own harvested reading only
 * when live discovery finds no running Antigravity surface at all
 * (`AntigravityUsageSourceError` with code `'UNAVAILABLE'` -- the exact
 * "no other Antigravity process is running" case this module exists to
 * soften). Any other outcome from the primary source is left untouched:
 * a successful read always wins outright, and the other error codes
 * (`'UNSUPPORTED'`, `'LOGIN_REQUIRED'`, `'ERROR'`) mean live discovery DID
 * find a real Antigravity surface and is reporting a genuine signal about
 * it -- overriding that with a stale local guess would hide real
 * information, not add to it. This is also why the existing
 * `APP -> AGY -> IDE` priority inside `HostAntigravityLocalUsageSource`
 * needs no changes at all: this wrapper only ever engages after that whole
 * search has already come back completely empty.
 */
/**
 * The route's only quota source: whatever the last own-child harvest saw.
 *
 * It used to sit behind a live machine-wide source, stepping in only when
 * that source found no running Antigravity surface at all. That source was
 * removed on 2026-09-03 -- it scanned every process on the machine and lifted
 * a CSRF token out of other processes' command lines, which contradicted this
 * package's own stated posture that it reads no credential or token store,
 * and both independent reviewers ranked removing it their second
 * simplification. See `docs/ROADMAP.md` section 3.
 *
 * What that cost -- quota unavailable until this plugin had run a turn -- was
 * recorded rather than glossed, and then paid off rather than left standing:
 * `quota-cold-harvest.ts` spawns a child for the reading alone, so the
 * pre-turn blind window is gone. Two limits remain, and both are the
 * vendor's: the figure never reflects usage by the IDE or the desktop app,
 * and the RPC's own content can come back with no remaining-fraction at all,
 * which the parser turns into an honest absence. What is kept throughout is
 * the boundary: this package reads only processes it started itself.
 */
export class AntigravityOwnChildQuotaSource implements AntigravityUsageCapabilitySource {
  /**
   * @param cache - Readings harvested from turn children, opportunistically.
   * @param coldHarvest - Spawns a child for this reading alone when there is
   * no recent one, so quota does not have to wait for a turn. Optional
   * because it needs a provider context the cache is built without; a source
   * constructed without it behaves exactly as it did before -- no number
   * until a turn has run.
   */
  constructor(
    private readonly cache: AntigravityQuotaHarvestCache,
    private readonly coldHarvest?: AntigravityColdQuotaHarvest,
  ) {}

  async read(): Promise<AntigravityObservation> {
    const cached = this.cache.read()
    if (cached) return cached
    const cold = await this.coldHarvest?.()
    if (cold) return cold
    throw new AntigravityUsageSourceError(
      'No Antigravity quota reading available: this route reads quota from its own `agy` child, and '
      + 'neither a recent turn nor a cold read produced one.',
      'UNAVAILABLE',
    )
  }
}
