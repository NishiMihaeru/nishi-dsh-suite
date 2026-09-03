import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createColdQuotaHarvest } from '../src/quota-cold-harvest.ts'
import { AntigravityOwnChildQuotaSource, AntigravityQuotaHarvestCache } from '../src/quota-harvest-cache.ts'
import { AntigravityUsageSourceError } from '../src/usage.ts'

/**
 * Quota without a prior turn.
 *
 * Narrowing the harvest to this package's own `agy` child left a real hole:
 * no number existed until a turn had run. It is closed by spawning a child
 * for the reading alone -- verified against real `agy 1.1.25`, which exposes
 * the loopback listener at +261 ms and serves the real payload at +1.8 s
 * with nothing written to its stdin, nothing billed, and no conversation
 * recorded (`docs/verification/agy-cli-contract.md`, finding 14).
 *
 * A cold start is cheap rather than free -- a real process, and the ordinary
 * vendor state any run writes -- so what is pinned here is mostly the
 * restraint: no stdin, one child at a time, not more than one per interval,
 * the directory removed, and no failure of any of it ever reaching a caller.
 */

const VALID_QUOTA_BODY = JSON.stringify({
  response: {
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          {
            bucketId: 'gemini-session',
            displayName: 'Session',
            remaining: { remainingFraction: 0.42 },
            window: '5 hour',
          },
        ],
      },
    ],
  },
})

const harvestConfig = {
  executable: 'agy',
  env: {},
  disposeGraceMs: 50,
  minIntervalMs: 60_000,
}

/** A child that exposes a pid and records everything done to it. */
function harvestChild(pid: number | undefined, record: HarvestChildRecord) {
  const stdin = new PassThrough()
  stdin.on('data', chunk => { record.stdinWrites.push(String(chunk)) })
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  return {
    pid,
    stdin,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() {
      record.terminated += 1
      done.resolve({ exitCode: 1, signal: null })
    },
    async waitForExit() { await done.promise; record.waited += 1; return true },
  }
}

interface HarvestChildRecord {
  spawns: { argv: readonly string[]; cwd: string }[]
  stdinWrites: string[]
  terminated: number
  waited: number
}

function harvestCtx(pid: number | undefined, onSpawn?: () => void) {
  const record: HarvestChildRecord = { spawns: [], stdinWrites: [], terminated: 0, waited: 0 }
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; cwd: string }) {
        record.spawns.push({ argv: [...spec.argv], cwd: spec.cwd })
        onSpawn?.()
        return harvestChild(pid, record)
      },
    },
  } as any
  return { ctx, record }
}

function servingCache(onFetch?: () => void) {
  return new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 4321 }],
    requestTransport: async () => {
      onFetch?.()
      return { status: 200, body: VALID_QUOTA_BODY }
    },
    maxAttempts: 1,
  })
}

/** A cache whose listener never answers, so the harvest comes back empty. */
function silentCache() {
  return new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [],
    maxAttempts: 1,
  })
}

test('a cold harvest reads quota from a child of its own, with nothing written to stdin', async () => {
  const { ctx, record } = harvestCtx(7001)
  const harvest = createColdQuotaHarvest(ctx, harvestConfig, servingCache())

  const observation = await harvest()

  assert.ok(observation, 'expected a reading')
  assert.equal(observation?.kind, 'NUMERIC_USAGE_AVAILABLE')
  assert.equal(record.spawns.length, 1)
  // Nothing was asked of the model, so nothing can have been billed.
  assert.deepEqual(record.stdinWrites, [])
  // And the child is gone through the grace path rather than left running.
  assert.equal(record.terminated, 1)
  assert.equal(record.waited, 1)
})

test('the cold harvest child carries no model, no schema and no agent', async () => {
  const { ctx, record } = harvestCtx(7001)
  const harvest = createColdQuotaHarvest(ctx, harvestConfig, servingCache())

  await harvest()

  const argv = record.spawns[0]?.argv ?? []
  assert.ok(argv.includes('--input-format'), 'the listener needs the stream-json shape')
  for (const flag of ['--model', '--json-schema', '--agent', '--effort', '--print-timeout']) {
    assert.ok(!argv.includes(flag), `a quota read must not carry ${flag}`)
  }
})

test('the cold harvest runs in a scratch directory of its own, removed afterwards', async () => {
  const { ctx, record } = harvestCtx(7001)
  const harvest = createColdQuotaHarvest(ctx, harvestConfig, servingCache())

  await harvest()

  const cwd = record.spawns[0]?.cwd ?? ''
  assert.ok(cwd.startsWith(tmpdir()), `expected a temp directory, got ${cwd}`)
  assert.match(cwd, /dsh-antigravity-quota-/)
  const remaining = await readdir(cwd).then(() => true, () => false)
  assert.equal(remaining, false, 'the scratch directory must not survive the harvest')
})

test('two callers arriving together share one child', async () => {
  let releaseFetch: (() => void) | undefined
  const gate = new Promise<void>(resolve => { releaseFetch = resolve })
  const { ctx, record } = harvestCtx(7001)
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 4321 }],
    requestTransport: async () => {
      await gate
      return { status: 200, body: VALID_QUOTA_BODY }
    },
    maxAttempts: 1,
  })
  const harvest = createColdQuotaHarvest(ctx, harvestConfig, cache)

  const both = Promise.all([harvest(), harvest()])
  releaseFetch?.()
  const [first, second] = await both

  assert.ok(first)
  assert.ok(second)
  assert.equal(record.spawns.length, 1, 'a second concurrent caller must not spawn a second child')
})

test('a second harvest inside the interval reuses the reading instead of a second child', async () => {
  const { ctx, record } = harvestCtx(7001)
  let clock = 1_000_000
  const harvest = createColdQuotaHarvest(
    ctx,
    { ...harvestConfig, now: () => clock },
    servingCache(),
  )

  await harvest()
  clock += 30_000
  const second = await harvest()

  assert.ok(second, 'the cached reading is still served')
  assert.equal(record.spawns.length, 1)

  clock += 31_000
  await harvest()
  assert.equal(record.spawns.length, 2, 'past the interval, a new child is allowed')
})

test('a harvest whose child never yields a pid returns nothing and throws nothing', async () => {
  const { ctx, record } = harvestCtx(undefined)
  const harvest = createColdQuotaHarvest(ctx, harvestConfig, servingCache())

  assert.equal(await harvest(), undefined)
  assert.equal(record.spawns.length, 1)
  assert.equal(record.terminated, 1, 'the child is still disposed')
})

test('a spawn that throws is swallowed, and the next harvest is still allowed', async () => {
  let fail = true
  const record: HarvestChildRecord = { spawns: [], stdinWrites: [], terminated: 0, waited: 0 }
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; cwd: string }) {
        record.spawns.push({ argv: [...spec.argv], cwd: spec.cwd })
        if (fail) throw new Error('no such executable')
        return harvestChild(7002, record)
      },
    },
  } as any
  let clock = 2_000_000
  const harvest = createColdQuotaHarvest(ctx, { ...harvestConfig, now: () => clock }, servingCache())

  assert.equal(await harvest(), undefined)
  fail = false
  clock += 61_000
  assert.ok(await harvest(), 'a later harvest is not poisoned by the earlier failure')
})

// ---------------------------------------------------------------------------
// The source that decides when to spend a child
// ---------------------------------------------------------------------------

test('a recent harvested reading wins outright, and no child is spawned for it', async () => {
  const cache = servingCache()
  await cache.harvest(9001)
  let coldCalls = 0
  const source = new AntigravityOwnChildQuotaSource(cache, async () => {
    coldCalls += 1
    return undefined
  })

  const observation = await source.read()

  assert.equal(observation.kind, 'NUMERIC_USAGE_AVAILABLE')
  assert.equal(coldCalls, 0, 'the cold path is for the absence of a reading, not for refreshing one')
})

test('with no reading and no cold harvest, the source still reports an honest absence', async () => {
  const source = new AntigravityOwnChildQuotaSource(silentCache())

  await assert.rejects(source.read(), (error: unknown) => {
    assert.ok(error instanceof AntigravityUsageSourceError)
    assert.equal(error.code, 'UNAVAILABLE')
    return true
  })
})

test('with no reading, the cold harvest is what answers', async () => {
  const { ctx } = harvestCtx(7001)
  const cache = servingCache()
  const source = new AntigravityOwnChildQuotaSource(cache, createColdQuotaHarvest(ctx, harvestConfig, cache))

  const observation = await source.read()

  assert.equal(observation.kind, 'NUMERIC_USAGE_AVAILABLE')
})

test('a cold harvest that finds nothing leaves the absence honest rather than erroring differently', async () => {
  const { ctx } = harvestCtx(7001)
  const cache = silentCache()
  // A listener that never appears is polled until the deadline, which is
  // what ends the wait -- shortened here so the test measures the deadline
  // rather than sitting through the production one.
  const cold = createColdQuotaHarvest(ctx, { ...harvestConfig, deadlineMs: 200 }, cache)
  const source = new AntigravityOwnChildQuotaSource(cache, cold)

  await assert.rejects(source.read(), (error: unknown) => {
    assert.ok(error instanceof AntigravityUsageSourceError)
    assert.equal(error.code, 'UNAVAILABLE')
    return true
  })
})
