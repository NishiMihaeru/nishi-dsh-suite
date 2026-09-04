/**
 * Quota read the way the vendor actually answers it: ACP `_x.ai/billing`
 * over `grok agent stdio`.
 *
 * Finding 8 of `docs/verification/grok-cli-contract.md` concluded there was
 * no machine-readable quota channel, because `grok -p "/usage"` is not a
 * command — it reaches the model as prose. That finding is still true of
 * `/usage`. It is not true of the ACP surface: after `initialize`, with no
 * session and no turn, `_x.ai/billing` returns `config.creditUsagePercent`
 * and an open `currentPeriod`. Measured on real `grok 1.0.13`.
 *
 * The method is a vendor extension, undocumented in the representative
 * `x.ai/*` tables, the same class of dependency as finding 9's catalog
 * handshake. Omarchy's collector (github.com/omacom/omarchy/pull/6485) found
 * it first and drives it the same way: Grok owns the call, so this source
 * never reads the vendor credential store and never talks to an xAI endpoint
 * itself.
 *
 * A window with no finite percentage, or whose period has already closed, is
 * not a meter of zero — it is no meter. Prepaid/on-demand fields have been
 * seen only as `{val: 0}` with no unit, so they are not projected.
 *
 * @module nishi-dsh-grok/usage-billing
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { disposeVendorChild, outputLines } from 'nishi-dsh-core/runtime'
import {
  GrokUsageSourceError,
  type GrokBillingWindowObservation,
  type GrokNumericUsageObservation,
  type GrokUsageCapabilitySource,
} from './usage.js'
import {
  agentStdioArgv,
  record,
  resolveVendorInvocation,
} from './grok-vendor.js'

/** Same override key the catalog and turn paths use; a Windows shim still needs one. */
const WINDOWS_EXECUTABLE_ENV = 'DSH_GROK_CLI_EXECUTABLE'

/** The vendor extension that carries the weekly credit allowance. */
export const GROK_BILLING_METHOD = '_x.ai/billing'

const INITIALIZE_REQUEST_ID = 1
const BILLING_REQUEST_ID = 2

/** Ceiling on the whole read, spawn included. Overridable; catalogTimeoutMs is the production value. */
const USAGE_BILLING_DEADLINE_MS = 20_000

/** Billing replies are a few kilobytes; anything past this is not one. */
const USAGE_BILLING_MAX_LINE_BYTES = 64 * 1024

/**
 * Floor on how often a process may be spent, successful or not.
 *
 * Not a cache of correctness — the last good reading is served inside the
 * window, which is what makes a fast refresh cheap instead of stale-looking.
 */
const USAGE_BILLING_MIN_INTERVAL_MS = 60_000

export interface GrokUsageBillingConfig {
  readonly executable: string
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly timeoutMs?: number
  readonly stderrMaxBytes?: number
  readonly minIntervalMs?: number
  readonly now?: () => number
}

function windowKindOf(type: unknown, durationMs: number | undefined): GrokBillingWindowObservation['windowKind'] {
  const kind = String(type ?? '').toUpperCase().replace(/^USAGE_PERIOD_TYPE_/, '')
  if (kind === 'WEEKLY') return 'WEEKLY'
  if (kind === 'DAILY') return 'SHORT'
  if (durationMs !== undefined) {
    const days = durationMs / 86_400_000
    if (days >= 6.5 && days <= 7.5) return 'WEEKLY'
    if (days > 0 && days <= 1.5) return 'SHORT'
  }
  return 'OTHER'
}

function windowLabel(kind: GrokBillingWindowObservation['windowKind']): string {
  if (kind === 'WEEKLY') return 'Weekly'
  if (kind === 'SHORT') return 'Daily'
  return 'Credits'
}

function windowId(kind: GrokBillingWindowObservation['windowKind']): string {
  if (kind === 'WEEKLY') return 'weekly'
  if (kind === 'SHORT') return 'daily'
  return 'credits'
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * Turn one `_x.ai/billing` result into a window, or `undefined` if this is
 * not a usable meter.
 *
 * `nowMs` decides whether the period is still open. A percentage belongs to
 * the period it was measured in, so one from a week that has since rolled
 * over is the wrong week's number — showing nothing beats showing it against
 * this week's reset.
 */
export function usageWindowFromBilling(
  result: unknown,
  nowMs: number,
): GrokBillingWindowObservation | undefined {
  const body = record(result)
  const config = record(body?.config)
  if (config === undefined) return undefined

  const percent = config.creditUsagePercent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined

  const period = record(config.currentPeriod) ?? record(config.current_period) ?? {}
  const startMs = parseTimestamp(period.start) ?? parseTimestamp(config.billingPeriodStart)
  const endMs = parseTimestamp(period.end) ?? parseTimestamp(config.billingPeriodEnd)
  if (startMs === undefined || endMs === undefined) return undefined
  if (!(startMs <= nowMs && nowMs <= endMs)) return undefined

  const durationMs = endMs > startMs ? endMs - startMs : undefined
  const windowKind = windowKindOf(period.type ?? period.period_type, durationMs)
  const tier = body?.subscription_tier ?? body?.subscriptionTier
  const tierLabel = typeof tier === 'string' && tier.trim().length > 0 ? tier.trim() : undefined

  return {
    id: windowId(windowKind),
    windowKind,
    label: windowLabel(windowKind),
    usedPercent: clampPercent(percent),
    ...(endMs !== undefined ? { resetsAtMs: endMs } : {}),
    ...(durationMs === undefined ? {} : { windowDurationMs: durationMs }),
    ...(tierLabel === undefined ? {} : { tierLabel }),
  }
}

function rpcLine(id: number, method: string, params: Record<string, unknown>): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
}

/**
 * The quota source for one provider registration.
 *
 * Single-flighted so concurrent panel refreshes share one process, and
 * rate-limited so a refresh loop cannot become a spawn loop. Inside the
 * window the last good reading is served; with no reading yet, the caller
 * gets the same honest unavailability it would get from a failed read.
 */
export class GrokUsageBillingSource implements GrokUsageCapabilitySource {
  private inFlight: Promise<GrokNumericUsageObservation | undefined> | undefined
  private lastAttemptAtMs: number | undefined
  private last: GrokNumericUsageObservation | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: GrokUsageBillingConfig,
  ) {}

  async read(): Promise<GrokNumericUsageObservation> {
    const observation = await this.observe()
    if (observation) return observation
    throw new GrokUsageSourceError(
      'No Grok quota reading available: ACP `_x.ai/billing` produced no open period carrying a credit percentage.',
      'UNAVAILABLE',
    )
  }

  private async observe(): Promise<GrokNumericUsageObservation | undefined> {
    if (this.inFlight) return await this.inFlight
    const now = this.config.now ?? Date.now
    const minIntervalMs = this.config.minIntervalMs ?? USAGE_BILLING_MIN_INTERVAL_MS
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

  private async run(): Promise<GrokNumericUsageObservation | undefined> {
    const controller = new AbortController()
    const deadlineMs = this.config.timeoutMs ?? USAGE_BILLING_DEADLINE_MS
    const deadline = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(new Error('grok-usage: ACP billing timed out'))
    }, deadlineMs)
    deadline.unref?.()
    let root: string | undefined
    try {
      root = await mkdtemp(join(tmpdir(), 'dsh-grok-usage-'))
      const invocation = await resolveVendorInvocation(
        this.ctx,
        this.config.executable,
        this.config.env,
        agentStdioArgv(),
        controller.signal,
        WINDOWS_EXECUTABLE_ENV,
      )
      const child = this.ctx.subprocess.spawn({
        argv: [...invocation.argv],
        cwd: root,
        stdio: {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: { maxBytes: this.config.stderrMaxBytes ?? 4096 },
        },
        graceMs: this.config.disposeGraceMs,
        signal: controller.signal,
        env: { ...invocation.env },
      })
      try {
        const stdin = child.stdin
        const stdout = child.stdout
        if (!stdin || !stdout) return undefined
        stdin.on('error', () => {})
        stdout.on('error', () => {})

        const lines = outputLines(stdout, USAGE_BILLING_MAX_LINE_BYTES)[Symbol.asyncIterator]()
        const nextMatching = async (id: number): Promise<Record<string, unknown> | undefined> => {
          for (;;) {
            const step = await lines.next()
            if (step.done) return undefined
            const line = step.value
            if (typeof line !== 'string' || line.trim().length === 0) continue
            let parsed: unknown
            try {
              parsed = JSON.parse(line)
            } catch {
              throw new Error('grok-usage: ACP billing stream emitted malformed JSON')
            }
            const message = record(parsed)
            if (message === undefined || message.id !== id) continue
            return message
          }
        }

        stdin.write(rpcLine(INITIALIZE_REQUEST_ID, 'initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
        }))
        const initialize = await nextMatching(INITIALIZE_REQUEST_ID)
        if (initialize === undefined || record(initialize.error) !== undefined) return undefined

        stdin.write(rpcLine(BILLING_REQUEST_ID, GROK_BILLING_METHOD, {}))
        const billing = await nextMatching(BILLING_REQUEST_ID)
        if (billing === undefined || record(billing.error) !== undefined) return undefined

        const now = this.config.now ?? Date.now
        const window = usageWindowFromBilling(billing.result, now())
        if (window === undefined) return undefined
        return { kind: 'NUMERIC_USAGE_AVAILABLE', windows: [window] }
      } finally {
        if (!controller.signal.aborted) controller.abort(new Error('grok-usage: billing complete'))
        await disposeVendorChild(child).catch(() => {})
      }
    } catch {
      // A failed read is indistinguishable, to the caller, from one that was
      // never possible. Vendor stderr is never inspected here.
      return undefined
    } finally {
      clearTimeout(deadline)
      if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(() => {})
    }
  }
}
