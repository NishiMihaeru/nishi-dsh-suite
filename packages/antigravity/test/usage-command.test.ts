import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravityUsageCommandSource, usageWindowsFrom } from '../src/usage-command.ts'
import { AntigravityUsageSourceError, normalizeAntigravityCapability } from '../src/usage.ts'

/**
 * The published quota channel, and the three properties that decide whether
 * it may replace a private one: it must be read without an agent turn, it
 * must never invent headroom out of a missing field, and it must not let a
 * refresh loop become a spawn loop.
 *
 * The payload below is the real `command.data` of `agy -p "/usage"
 * --output-format json` on `agy 1.1.25`, trimmed only of prose descriptions
 * (`docs/verification/agy-cli-contract.md`, finding 17).
 */
const REAL_PAYLOAD = {
  description: 'Within each group, models share a weekly limit and a 5-hour limit.',
  groups: [
    {
      name: 'Gemini Models',
      description: 'Models within this group: Gemini Flash, Gemini Pro',
      buckets: [
        {
          id: 'gemini-weekly',
          name: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining_fraction: 0.9857444763183594,
          reset_time: '2026-09-10T18:35:50Z',
        },
        {
          id: 'gemini-5h',
          name: 'Five Hour Limit Remaining',
          window: '5h',
          remaining_fraction: 0.9622176885604858,
          reset_time: '2026-09-04T04:35:50Z',
        },
      ],
    },
    {
      name: 'Claude and GPT models',
      description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
      buckets: [
        {
          id: '3p-weekly',
          name: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining_fraction: 0.9682356119155884,
          reset_time: '2026-09-07T00:52:12Z',
        },
      ],
    },
  ],
}

function envelope(payload: unknown, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    conversation_id: '',
    status: 'SUCCESS',
    response: '',
    num_turns: 0,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    command: { name: 'usage', data: payload },
    ...overrides,
  })
}

/** A collected child that exits immediately with `stdout` already buffered. */
function usageChild(stdout: string, exitCode = 0) {
  return {
    pid: 7100,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdout, nextOffset: stdout.length, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate() {},
    async waitForExit() { return true },
  }
}

function harness(stdout: string) {
  const spawns: { argv: string[]; stdio: any }[] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; stdio: unknown }) {
        spawns.push({ argv: [...spec.argv], stdio: spec.stdio })
        return usageChild(stdout)
      },
    },
  } as any
  return { ctx, spawns }
}

const config = { executable: 'agy', env: {}, disposeGraceMs: 50 }

test('the real /usage payload becomes one window per bucket, named the way the vendor names it', () => {
  const windows = usageWindowsFrom(REAL_PAYLOAD)
  assert.equal(windows.length, 3)

  const [weekly, short] = windows
  assert.equal(weekly.scopeId, 'gemini-weekly')
  assert.equal(weekly.windowKind, 'WEEKLY')
  assert.equal(weekly.label, 'Weekly Limit Remaining')
  // The whole point of the published channel: the pool name is given, not
  // derived by stripping cadence words off a label that has none left.
  assert.equal(weekly.poolLabel, 'Gemini Models')
  assert.equal(weekly.poolId, 'gemini-models')
  assert.ok(Math.abs(weekly.usedPercent - 1.4255523681640625) < 1e-9)
  assert.equal(weekly.resetsAtMs, Date.parse('2026-09-10T18:35:50Z'))

  assert.equal(short.windowKind, 'SHORT')
  assert.equal(windows[2].poolLabel, 'Claude and GPT models')
})

test('a bucket carrying no finite fraction is skipped rather than read as full headroom', () => {
  const windows = usageWindowsFrom({
    groups: [{
      name: 'Gemini Models',
      buckets: [
        { id: 'gemini-weekly', name: 'Weekly', window: 'weekly' },
        { id: 'gemini-5h', name: 'Five Hour', window: '5h', remaining_fraction: null },
        { id: 'gemini-other', name: 'Other', window: 'monthly', remaining_fraction: 0.5 },
      ],
    }],
  })
  assert.deepEqual(windows.map(w => w.scopeId), ['gemini-other'])
  assert.equal(windows[0].windowKind, 'OTHER')
  assert.equal(windows[0].usedPercent, 50)
})

test('a payload that is not a usage payload yields no windows at all', () => {
  assert.deepEqual(usageWindowsFrom(undefined), [])
  assert.deepEqual(usageWindowsFrom({}), [])
  assert.deepEqual(usageWindowsFrom({ groups: 'nope' }), [])
  assert.deepEqual(usageWindowsFrom({ groups: [{ name: 'x', buckets: [] }] }), [])
})

test('the source reads the published command, spends no turn, and writes nothing to stdin', async () => {
  const { ctx, spawns } = harness(envelope(REAL_PAYLOAD))
  const observation = await new AntigravityUsageCommandSource(ctx, config).read()

  assert.equal(observation.kind, 'NUMERIC_USAGE_AVAILABLE')
  assert.equal(observation.windows.length, 3)
  assert.equal(spawns.length, 1)
  assert.deepEqual(spawns[0].argv.slice(-4), ['-p', '/usage', '--output-format', 'json'])
  // No stdin means no way to start an agent turn, which is what makes the
  // read free rather than merely cheap.
  assert.equal(spawns[0].stdio.stdin, 'ignore')
})

test('a reading with nothing usable in it is an honest absence, not a zero', async () => {
  for (const stdout of ['', 'not json', envelope({ groups: [] }), envelope(REAL_PAYLOAD, { status: 'ERROR' })]) {
    const { ctx } = harness(stdout)
    await assert.rejects(
      () => new AntigravityUsageCommandSource(ctx, config).read(),
      (error: unknown) => {
        assert.ok(error instanceof AntigravityUsageSourceError)
        assert.equal(error.code, 'UNAVAILABLE')
        return true
      },
    )
  }
})

test('a refresh loop cannot become a spawn loop, and serves the last reading meanwhile', async () => {
  const { ctx, spawns } = harness(envelope(REAL_PAYLOAD))
  let clock = 1_000
  const source = new AntigravityUsageCommandSource(ctx, {
    ...config,
    minIntervalMs: 60_000,
    now: () => clock,
  })

  const first = await source.read()
  clock += 5_000
  const second = await source.read()
  assert.equal(spawns.length, 1, 'a second read inside the window spends no process')
  assert.deepEqual(second, first)

  clock += 60_000
  await source.read()
  assert.equal(spawns.length, 2, 'past the window the process is spent again')
})

test('concurrent reads share one process rather than racing two', async () => {
  const { ctx, spawns } = harness(envelope(REAL_PAYLOAD))
  const source = new AntigravityUsageCommandSource(ctx, config)
  const [a, b] = await Promise.all([source.read(), source.read()])
  assert.equal(spawns.length, 1)
  assert.deepEqual(a, b)
})

test('the vendor group name reaches the usage snapshot as the pool, and buckets keep their own windows', () => {
  const snapshot = normalizeAntigravityCapability(
    { kind: 'NUMERIC_USAGE_AVAILABLE', windows: usageWindowsFrom(REAL_PAYLOAD) },
    1_700_000_000_000,
  )
  const scopes = snapshot.windows.map(w => [w.scope.id, w.scope.label])
  assert.deepEqual(scopes, [
    ['gemini-models', 'Gemini Models'],
    ['gemini-models', 'Gemini Models'],
    ['claude-and-gpt-models', 'Claude and GPT models'],
  ])
  // One pool, two cadences: the windows themselves must stay distinct.
  assert.deepEqual(
    snapshot.windows.map(w => w.id),
    ['antigravity-gemini-weekly', 'antigravity-gemini-5h', 'antigravity-3p-weekly'],
  )
})
