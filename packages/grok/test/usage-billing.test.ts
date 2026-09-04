import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { GrokUsageSourceError } from '../src/usage.ts'
import {
  GROK_BILLING_METHOD,
  GrokUsageBillingSource,
  usageWindowFromBilling,
} from '../src/usage-billing.ts'

/**
 * A trimmed but verbatim `_x.ai/billing` result from `grok 1.0.13`, recorded
 * by the turn-free ACP probe in `docs/verification/grok-cli-contract.md`
 * (finding 18). The shape is undocumented, which is why it is pinned.
 */
const RECORDED_BILLING = {
  config: {
    creditUsagePercent: 64.0,
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-09-03T16:13:00.760610+00:00',
      end: '2026-09-10T16:13:00.760610+00:00',
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    prepaidBalance: { val: 0 },
    isUnifiedBillingUser: true,
    billingPeriodStart: '2026-09-03T16:13:00.760610+00:00',
    billingPeriodEnd: '2026-09-10T16:13:00.760610+00:00',
  },
}

const OPEN_NOW = Date.parse('2026-09-04T12:00:00Z')
const AFTER_PERIOD = Date.parse('2026-09-11T00:00:00Z')

function fakeBillingChild(received: unknown[], result: unknown = RECORDED_BILLING, opts: {
  failInitialize?: boolean
  failBilling?: boolean
  notify?: boolean
} = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let settled = false
  let resolveDone!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveDone = resolve
  })
  let buffer = ''

  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => {
    buffer += chunk
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const message = JSON.parse(line)
      received.push(message)
      if (opts.notify) {
        stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          method: '_x.ai/settings/update',
          params: { subscription_tier_display: null },
        })}\n`)
      }
      if (message.method === 'initialize') {
        stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          ...(opts.failInitialize ? { error: { code: -1, message: 'nope' } } : { result: { protocolVersion: 1 } }),
        })}\n`)
      }
      if (message.method === GROK_BILLING_METHOD) {
        stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          ...(opts.failBilling ? { error: { code: -32601, message: 'Method not found' } } : { result }),
        })}\n`)
      }
    }
  })

  const settle = () => {
    if (settled) return
    settled = true
    try { stdout.end() } catch { /* already ended */ }
    resolveDone({ exitCode: null, signal: 'SIGTERM' })
  }

  return {
    pid: 7101,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate: settle,
    async waitForExit() {
      await done
      return true
    },
  } as any
}

function harness(result: unknown = RECORDED_BILLING, opts?: Parameters<typeof fakeBillingChild>[2]) {
  const received: unknown[] = []
  const spawns: { argv: string[]; stdio: any }[] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/grok' },
      spawn(spec: { argv: readonly string[]; stdio: unknown }) {
        spawns.push({ argv: [...spec.argv], stdio: spec.stdio })
        return fakeBillingChild(received, result, opts)
      },
    },
  } as any
  return { ctx, spawns, received }
}

const config = {
  executable: 'grok',
  env: {},
  disposeGraceMs: 50,
  timeoutMs: 2_000,
  minIntervalMs: 60_000,
  now: () => OPEN_NOW,
}

test('the recorded billing result becomes one weekly window, and prepaid zeros are not a meter', () => {
  const window = usageWindowFromBilling(RECORDED_BILLING, OPEN_NOW)
  assert.equal(window?.id, 'weekly')
  assert.equal(window?.windowKind, 'WEEKLY')
  assert.equal(window?.label, 'Weekly')
  assert.equal(window?.usedPercent, 64)
  assert.equal(window?.resetsAtMs, Date.parse('2026-09-10T16:13:00.760610+00:00'))
  assert.equal(window?.tierLabel, undefined)
  assert.equal(
    window?.windowDurationMs,
    Date.parse('2026-09-10T16:13:00.760610+00:00') - Date.parse('2026-09-03T16:13:00.760610+00:00'),
  )
})

test('a missing percentage is no meter rather than a meter of zero', () => {
  assert.equal(usageWindowFromBilling({
    config: {
      currentPeriod: RECORDED_BILLING.config.currentPeriod,
      billingPeriodStart: RECORDED_BILLING.config.billingPeriodStart,
      billingPeriodEnd: RECORDED_BILLING.config.billingPeriodEnd,
    },
  }, OPEN_NOW), undefined)
  assert.equal(usageWindowFromBilling({
    config: { ...RECORDED_BILLING.config, creditUsagePercent: null },
  }, OPEN_NOW), undefined)
  assert.equal(usageWindowFromBilling({}, OPEN_NOW), undefined)
  assert.equal(usageWindowFromBilling(undefined, OPEN_NOW), undefined)
})

test('a percentage of zero is a real reading, not an absence', () => {
  const window = usageWindowFromBilling({
    config: { ...RECORDED_BILLING.config, creditUsagePercent: 0 },
  }, OPEN_NOW)
  assert.equal(window?.usedPercent, 0)
})

test('a closed period is dropped rather than shown against this week\'s reset', () => {
  assert.equal(usageWindowFromBilling(RECORDED_BILLING, AFTER_PERIOD), undefined)
})

test('subscription_tier is accepted in either spelling when the vendor sends it', () => {
  const snake = usageWindowFromBilling({ ...RECORDED_BILLING, subscription_tier: 'SuperGrok' }, OPEN_NOW)
  const camel = usageWindowFromBilling({ ...RECORDED_BILLING, subscriptionTier: 'SuperGrok' }, OPEN_NOW)
  assert.equal(snake?.tierLabel, 'SuperGrok')
  assert.equal(camel?.tierLabel, 'SuperGrok')
})

test('the source asks initialize then billing, opens no session, and spends no turn', { timeout: 3_000 }, async () => {
  const { ctx, spawns, received } = harness()
  const observation = await new GrokUsageBillingSource(ctx, config).read()

  assert.equal(observation.kind, 'NUMERIC_USAGE_AVAILABLE')
  assert.equal(observation.windows.length, 1)
  assert.equal(observation.windows[0]?.usedPercent, 64)
  assert.equal(spawns.length, 1)
  assert.deepEqual(spawns[0].argv.slice(-2), ['agent', 'stdio'])
  assert.equal(spawns[0].stdio.stdin, 'pipe')
  assert.deepEqual(
    received.map((message: any) => message.method),
    ['initialize', GROK_BILLING_METHOD],
  )
  assert.equal(
    received.some((message: any) => message.method === 'session/new' || message.method === 'session/prompt'),
    false,
  )
})

test('ACP notifications do not steal the billing reply', { timeout: 3_000 }, async () => {
  const { ctx } = harness(RECORDED_BILLING, { notify: true })
  const observation = await new GrokUsageBillingSource(ctx, config).read()
  assert.equal(observation.windows[0]?.usedPercent, 64)
})

test('a refresh inside the interval does not spawn again', { timeout: 3_000 }, async () => {
  const { ctx, spawns } = harness()
  const source = new GrokUsageBillingSource(ctx, config)
  await source.read()
  await source.read()
  assert.equal(spawns.length, 1)
})

test('concurrent reads share one process', { timeout: 3_000 }, async () => {
  const { ctx, spawns } = harness()
  const source = new GrokUsageBillingSource(ctx, config)
  const [a, b] = await Promise.all([source.read(), source.read()])
  assert.equal(spawns.length, 1)
  assert.equal(a.windows[0]?.usedPercent, b.windows[0]?.usedPercent)
})

test('a billing method error is unavailability, not invented headroom', { timeout: 3_000 }, async () => {
  const { ctx } = harness(RECORDED_BILLING, { failBilling: true })
  await assert.rejects(
    () => new GrokUsageBillingSource(ctx, { ...config, minIntervalMs: 0 }).read(),
    (error: unknown) => error instanceof GrokUsageSourceError && error.code === 'UNAVAILABLE',
  )
})

test('an initialize refusal never sends billing', { timeout: 3_000 }, async () => {
  const { ctx, received } = harness(RECORDED_BILLING, { failInitialize: true })
  await assert.rejects(
    () => new GrokUsageBillingSource(ctx, { ...config, minIntervalMs: 0 }).read(),
    (error: unknown) => error instanceof GrokUsageSourceError && error.code === 'UNAVAILABLE',
  )
  assert.equal(
    received.some((message: any) => message.method === GROK_BILLING_METHOD),
    false,
  )
})
