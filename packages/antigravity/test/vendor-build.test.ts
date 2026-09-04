import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { FAKE_VENDOR_BUILD, isVersionSpawn, versionChild } from './fake-vendor.ts'
import { stamped } from './turn-stamp.ts'

/**
 * The vendor build a failed turn ran against.
 *
 * `agy` self-updates, so which build produced a crash cannot be reconstructed
 * after the fact -- and the vendor publishes no version anywhere this route
 * already reads: not in the `init` event, not in the result envelope, and not
 * in its own `updater/update_status.json`, which holds only
 * `{"success":true,"message":"Already on the latest version."}`. The one
 * published surface is `agy --version`, which is a separate process.
 *
 * So the read is a real spawn, and everything here is about it costing
 * nothing: one attempt per adapter, never awaited, never fatal, and a
 * diagnostic that has no build says nothing rather than guessing.
 */

const primaryConfig = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 100,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  sessionIdleMs: 60_000,
}

/** A live stream-json child answering one failing `result` per line, staying up. */
function liveChild() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  let buffer = ''
  stdin.on('data', chunk => {
    buffer += String(chunk)
    let cut = buffer.indexOf('\n')
    while (cut !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      const result = stamped({ conversation_id: 'c1', status: 'ERROR' }, line)
      stdout.write(`${JSON.stringify({ event: 'result', result })}\n`)
      cut = buffer.indexOf('\n')
    }
  })
  return {
    pid: 4200,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stdout: undefined,
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() { done.resolve({ exitCode: 0, signal: null }); stdout.end() },
    async waitForExit() { return true },
  }
}

/** A turn child that exits without ever emitting a `result`. */
function dyingChild() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  stdin.on('data', () => {
    stdout.end()
    done.resolve({ exitCode: 1, signal: null })
  })
  return {
    pid: 4300,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stdout: undefined,
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() { done.resolve({ exitCode: 1, signal: null }); stdout.end() },
    async waitForExit() { await done.promise; return true },
  }
}

/** A `--version` child that never answers on its own, only when torn down. */
function hangingVersionChild() {
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  return {
    pid: 5200,
    stdin: undefined,
    stdout: new PassThrough(),
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() { done.resolve({ exitCode: null, signal: 'SIGTERM' as NodeJS.Signals }) },
    async waitForExit() { await done.promise; return true },
  }
}

/** A collected child for the catalog call: emits its lines, then exits. */
function catalogChild() {
  const stdout = new PassThrough()
  const text = [
    'Fetching available models...',
    JSON.stringify({
      conversation_id: '',
      status: 'SUCCESS',
      response: 'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
    }),
  ].map(line => `${line}\n`).join('')
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => {
    stdout.write(text)
    stdout.end()
    done.resolve({ exitCode: 0, signal: null })
  })
  return {
    pid: 3200,
    stdin: undefined,
    stdout,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text, nextOffset: text.length, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { return true },
  }
}

function ctxWith(version: () => unknown, turnChild: () => unknown = liveChild) {
  const versionSpawns: string[][] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (isVersionSpawn(spec.argv)) {
          versionSpawns.push([...spec.argv])
          return version()
        }
        if (spec.argv.includes('models')) return catalogChild()
        return turnChild()
      },
    },
  } as any
  return { ctx, versionSpawns }
}

let messageSeq = 0
function request(sessionId: string) {
  messageSeq += 1
  return {
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-low',
    sessionId,
    system: 'be useful',
    messages: [{
      id: `m${messageSeq}`,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'do the thing' }],
    }],
  } as any
}

/** The turn error for one request, which every test here expects to exist. */
async function failedTurn(adapter: AntigravityCliAdapter, sessionId: string): Promise<LlmError> {
  try {
    // eslint-disable-next-line no-unused-vars
    for await (const _chunk of adapter.stream(request(sessionId))) { /* consume */ }
  } catch (error: unknown) {
    assert.ok(error instanceof LlmError)
    return error
  }
  throw new Error('the turn was expected to fail')
}

test('a failed turn names the build it ran against', async () => {
  const { ctx } = ctxWith(() => versionChild())
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    // Two turns rather than one: the read is deliberately not awaited, so
    // asserting on the FIRST turn's message would be asserting on a race.
    await failedTurn(adapter, 'session-1')
    const second = await failedTurn(adapter, 'session-2')
    assert.match(second.message, new RegExp(`Vendor build ${FAKE_VENDOR_BUILD}\\.`))
  } finally { await adapter.dispose() }
})

test('a child that dies before a result names the build it died on', async () => {
  // The case the build exists for. A crash is where "which `agy` was this?"
  // is the first question and the one thing nobody can reconstruct later,
  // and it is a different code path from a turn that settles badly: the
  // diagnostic is authored inside the child wrapper rather than by the
  // adapter, which is why it is asserted separately.
  const { ctx } = ctxWith(() => versionChild(), dyingChild)
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await failedTurn(adapter, 'session-1')
    const second = await failedTurn(adapter, 'session-2')
    assert.match(second.message, /exited before a result event/)
    assert.match(second.message, new RegExp(`Vendor build ${FAKE_VENDOR_BUILD}\\.`))
  } finally { await adapter.dispose() }
})

test('the version read is attempted once per adapter, not once per turn', async () => {
  const { ctx, versionSpawns } = ctxWith(() => versionChild())
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await failedTurn(adapter, 'session-1')
    await failedTurn(adapter, 'session-2')
    await failedTurn(adapter, 'session-3')
    assert.equal(versionSpawns.length, 1, `expected one --version spawn, got ${versionSpawns.length}`)
  } finally { await adapter.dispose() }
})

test('a version read that never answers does not delay or fail a turn', async () => {
  const { ctx } = ctxWith(hangingVersionChild)
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    const first = await failedTurn(adapter, 'session-1')
    const second = await failedTurn(adapter, 'session-2')
    // The turn still fails on its own terms, with no build clause invented
    // for it and no wait for a read that is never coming.
    for (const error of [first, second]) {
      assert.match(error.message, /turn failed \(status ERROR\)/)
      assert.doesNotMatch(error.message, /Vendor build/)
    }
  } finally { await adapter.dispose() }
})

/**
 * `--version` output is vendor-authored text like every other byte read back
 * from the CLI, so only a version-shaped token may be kept -- never the line
 * it sat on, and never the text around it.
 */
const REJECTED: ReadonlyArray<{ readonly label: string; readonly stdout: string; readonly exitCode: number | null }> = [
  { label: 'a non-zero exit', stdout: '1.1.25\n', exitCode: 1 },
  { label: 'no version-shaped token', stdout: 'agy: unknown flag --version\n', exitCode: 0 },
  { label: 'empty output', stdout: '', exitCode: 0 },
]

for (const rejected of REJECTED) {
  test(`${rejected.label} leaves the diagnostic without a build`, async () => {
    const { ctx } = ctxWith(() => versionChild(rejected.stdout, rejected.exitCode))
    const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
    try {
      await failedTurn(adapter, 'session-1')
      const second = await failedTurn(adapter, 'session-2')
      assert.doesNotMatch(second.message, /Vendor build/)
    } finally { await adapter.dispose() }
  })
}

test('a version buried in a sentence yields the token alone, not the sentence', async () => {
  const { ctx } = ctxWith(() => versionChild('agy version 2.0.1-rc.4 (build deadbeef)\n', 0))
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig)
  try {
    await failedTurn(adapter, 'session-1')
    const second = await failedTurn(adapter, 'session-2')
    assert.match(second.message, /Vendor build 2\.0\.1-rc\.4\./)
    assert.doesNotMatch(second.message, /deadbeef/)
  } finally { await adapter.dispose() }
})
