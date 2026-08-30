import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  AntigravityQuotaFallbackUsageSource,
  AntigravityQuotaHarvestCache,
} from '../src/quota-harvest-cache.ts'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { AntigravityUsageCollector, AntigravityUsageSourceError } from '../src/usage.ts'

/**
 * Coverage for the opportunistic own-child quota harvest
 * (src/quota-harvest-cache.ts) and its wiring into a primary turn
 * (src/antigravity-primary.ts `runTurn`). None of this spawns a real `agy`;
 * every subprocess and every quota endpoint is a fake, following the
 * existing fake-subprocess harness style used by sandbox-flag.test.ts and
 * native-tool-block.test.ts.
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

const primaryConfig = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 1_000,
  stderrMaxBytes: 64_000,
}

const SUCCESS_RESULT_LINE = JSON.stringify({
  event: 'result',
  result: {
    status: 'SUCCESS',
    structured_output: { kind: 'message', text: 'hi', tool_calls: [] },
  },
})

/** A stream-json managed child: writes `lines` to stdout, then exits with `exitCode`/`stderr`. */
function streamingChild(opts: { pid?: number; lines?: readonly string[]; stderr?: string; exitCode?: number | null }) {
  const { pid = 3000, lines = [], stderr = '', exitCode = 0 } = opts
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  stdin.on('data', () => {})
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => {
    for (const line of lines) stdout.write(`${line}\n`)
    stdout.end()
    done.resolve({ exitCode, signal: null })
  })
  return {
    pid,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stderr: { readFrom() { return { text: stderr, nextOffset: stderr.length, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

function turnCtx(streamOpts: Parameters<typeof streamingChild>[0]) {
  return {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn() { return streamingChild(streamOpts) },
    },
  } as any
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

/** Polls `predicate` until it is true, or fails after `timeoutMs`. Used only to observe a deliberately backgrounded, fire-and-forget harvest settling -- never to paper over a race in the code under test. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// ---------------------------------------------------------------------------
// AntigravityQuotaHarvestCache in isolation
// ---------------------------------------------------------------------------

test('harvest() populates the cache from a listener serving a valid quota payload', async () => {
  const seenPids: number[] = []
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async (pid) => { seenPids.push(pid); return [{ host: '127.0.0.1', port: 4321 }] },
    requestTransport: async (url) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:4321\/exa\.language_server_pb\.LanguageServerService\/RetrieveUserQuotaSummary$/)
      return { status: 200, body: VALID_QUOTA_BODY }
    },
    maxAttempts: 1,
  })

  await cache.harvest(9001)

  assert.deepEqual(seenPids, [9001])
  const observation = cache.read()
  assert.ok(observation)
  assert.equal(observation?.kind, 'NUMERIC_USAGE_AVAILABLE')
  assert.equal(observation?.windows.length, 1)
  assert.equal(observation?.windows[0].usedPercent, 58)
})

test('harvest() tries https when http does not respond, on the same listener', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 555 }],
    requestTransport: async (url) => {
      if (url.startsWith('http://')) throw new Error('ECONNREFUSED')
      return { status: 200, body: VALID_QUOTA_BODY }
    },
    maxAttempts: 1,
  })

  await cache.harvest(1)

  assert.ok(cache.read())
})

for (const [label, config] of Object.entries({
  'no listeners at all': {
    discoverListeners: async () => [],
  },
  'listener discovery itself throws': {
    discoverListeners: async () => { throw new Error('discovery exploded') },
  },
  'connection refused': {
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => { throw new Error('ECONNREFUSED') },
  },
  'non-200 status': {
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 404, body: '' }),
  },
  'malformed JSON body': {
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 200, body: '{not json' }),
  },
  'well-formed JSON with no usable quota shape': {
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 200, body: JSON.stringify({ nothing: 'useful' }) }),
  },
  'request times out': {
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => { throw new Error('Request timed out') },
  },
} satisfies Record<string, Partial<ConstructorParameters<typeof AntigravityQuotaHarvestCache>[0]>>)) {
  test(`harvest() swallows failure and leaves the cache empty: ${label}`, async () => {
    const cache = new AntigravityQuotaHarvestCache({
      discoverListeners: async () => [],
      maxAttempts: 1,
      retryDelayMs: 0,
      ...config,
    } as ConstructorParameters<typeof AntigravityQuotaHarvestCache>[0])

    await assert.doesNotReject(cache.harvest(1))
    assert.equal(cache.read(), undefined)
  })
}

test('harvest() retries across the configured attempts before giving up', async () => {
  let calls = 0
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => {
      calls += 1
      if (calls < 3) return []
      return [{ host: '127.0.0.1', port: 1 }]
    },
    requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
    maxAttempts: 5,
    retryDelayMs: 0,
    delay: async () => {},
  })

  await cache.harvest(1)

  assert.equal(calls, 3)
  assert.ok(cache.read())
})

test('a stale cached observation is not served once past its staleness budget', async () => {
  let now = 1_000_000
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
    maxAttempts: 1,
    staleAfterMs: 1_000,
    now: () => now,
  })

  await cache.harvest(1)
  assert.ok(cache.read(), 'freshly harvested reading is served')

  now += 999
  assert.ok(cache.read(), 'still within the staleness budget')

  now += 2
  assert.equal(cache.read(), undefined, 'now past the staleness budget')
})

test('a harvest failure carrying vendor-looking secret text never surfaces anywhere', async () => {
  const secret = 'agy_super_secret_token_ABC123 /home/user/.antigravity/creds'
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const discoveryFailureCache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => { throw new Error(secret) },
    maxAttempts: 1,
  })
  await assert.doesNotReject(discoveryFailureCache.harvest(1))
  assert.equal(discoveryFailureCache.read(), undefined)

  const transportFailureCache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => { throw new Error(secret) },
    maxAttempts: 1,
  })
  await assert.doesNotReject(transportFailureCache.harvest(1))
  assert.equal(transportFailureCache.read(), undefined)

  const source = new AntigravityQuotaFallbackUsageSource(
    { async read() { throw new AntigravityUsageSourceError('unavailable', 'UNAVAILABLE') } },
    transportFailureCache,
  )
  const collector = new AntigravityUsageCollector(source)
  const snapshot = await collector.collect(1)
  assert.equal(snapshot.status, 'UNAVAILABLE')
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(escaped))
})

// ---------------------------------------------------------------------------
// AntigravityQuotaFallbackUsageSource / collector wiring
// ---------------------------------------------------------------------------

test('the collector serves the harvested cache when live discovery finds nothing (UNAVAILABLE)', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
    maxAttempts: 1,
  })
  await cache.harvest(1)
  assert.ok(cache.read())

  const source = new AntigravityQuotaFallbackUsageSource(
    { async read() { throw new AntigravityUsageSourceError('nothing running', 'UNAVAILABLE') } },
    cache,
  )
  const collector = new AntigravityUsageCollector(source)
  const snapshot = await collector.collect(1234)

  assert.equal(snapshot.status, 'AVAILABLE')
  assert.equal(snapshot.windows.length, 1)
})

test('the collector prefers live discovery over the harvest cache when live discovery succeeds', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
    maxAttempts: 1,
  })
  await cache.harvest(1)
  assert.ok(cache.read(), 'cache has a reading available, so we can prove it is NOT the one served')

  const liveObservation = {
    kind: 'NUMERIC_USAGE_AVAILABLE' as const,
    windows: [{ windowKind: 'SHORT' as const, label: 'Live Reading', usedPercent: 7 }],
  }
  const source = new AntigravityQuotaFallbackUsageSource({ async read() { return liveObservation } }, cache)
  const collector = new AntigravityUsageCollector(source)
  const snapshot = await collector.collect(1)

  assert.equal(snapshot.status, 'AVAILABLE')
  assert.equal(snapshot.windows[0].label, 'Live Reading')
  assert.equal(snapshot.windows[0].usedPercent, 7)
})

for (const code of ['UNSUPPORTED', 'LOGIN_REQUIRED', 'ERROR'] as const) {
  test(`the fallback source does not override a live-discovery ${code} with a cached reading`, async () => {
    const cache = new AntigravityQuotaHarvestCache({
      discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
      requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
      maxAttempts: 1,
    })
    await cache.harvest(1)
    assert.ok(cache.read())

    const source = new AntigravityQuotaFallbackUsageSource(
      { async read() { throw new AntigravityUsageSourceError(`primary says ${code}`, code) } },
      cache,
    )
    await assert.rejects(source.read(), AntigravityUsageSourceError)
  })
}

test('a stale cached observation is not served by the fallback source either', async () => {
  let now = 0
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [{ host: '127.0.0.1', port: 1 }],
    requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
    maxAttempts: 1,
    staleAfterMs: 100,
    now: () => now,
  })
  await cache.harvest(1)
  now += 1_000

  const source = new AntigravityQuotaFallbackUsageSource(
    { async read() { throw new AntigravityUsageSourceError('nothing running', 'UNAVAILABLE') } },
    cache,
  )
  await assert.rejects(source.read(), AntigravityUsageSourceError)
})

// ---------------------------------------------------------------------------
// Wiring into a real primary turn (antigravity-primary.ts runTurn)
// ---------------------------------------------------------------------------

test('a turn feeds the harvest cache from its own spawned child pid, and the collector then reports numeric usage', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async (pid) => {
      assert.equal(pid, 4242)
      return [{ host: '127.0.0.1', port: 9 }]
    },
    requestTransport: async () => ({ status: 200, body: VALID_QUOTA_BODY }),
    maxAttempts: 1,
  })
  const ctx = turnCtx({ pid: 4242, lines: [SUCCESS_RESULT_LINE] })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig, cache)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await drain(adapter.stream(options))
  await waitFor(() => cache.read() !== undefined)

  const source = new AntigravityQuotaFallbackUsageSource(
    { async read() { throw new AntigravityUsageSourceError('nothing running', 'UNAVAILABLE') } },
    cache,
  )
  const snapshot = await new AntigravityUsageCollector(source).collect(1)
  assert.equal(snapshot.status, 'AVAILABLE')
})

test('a harvest that never resolves does not delay, block, or fail the turn', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: () => new Promise(() => {}), // never settles
  })
  const ctx = turnCtx({ lines: [SUCCESS_RESULT_LINE] })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig, cache)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(chunks.some((chunk) => (chunk as { type?: string }).type === 'finish'))
})

test('a harvest whose listener discovery throws synchronously does not fail the turn', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: () => { throw new Error('boom') },
    maxAttempts: 1,
  })
  const ctx = turnCtx({ lines: [SUCCESS_RESULT_LINE] })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig, cache)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(chunks.some((chunk) => (chunk as { type?: string }).type === 'finish'))
})

test('a turn that itself fails is unaffected by the harvest cache being present', async () => {
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: async () => [],
    maxAttempts: 1,
  })
  const ctx = turnCtx({ lines: [], stderr: 'agy: some ordinary failure', exitCode: 1 })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig, cache)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  await assert.rejects(drain(adapter.stream(options)))
})

test('an adapter constructed with no harvest cache at all runs turns normally', async () => {
  const ctx = turnCtx({ lines: [SUCCESS_RESULT_LINE] })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  const options = { provider: 'antigravity-cli', model: 'gemini-1.5-pro', messages: [] } as any

  const chunks = await drain(adapter.stream(options))

  assert.ok(chunks.some((chunk) => (chunk as { type?: string }).type === 'finish'))
})
