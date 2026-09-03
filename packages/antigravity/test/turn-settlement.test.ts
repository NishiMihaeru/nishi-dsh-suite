import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { VendorFailure } from 'nishi-dsh-core/runtime'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import { noopQuotaHarvestCache } from '../src/quota-harvest-cache.ts'
import { stamped } from './turn-stamp.ts'
import { isVersionSpawn, versionChild } from './fake-vendor.ts'

/**
 * What a vendor turn settles as, and what that settlement is reported as.
 *
 * `agy` publishes seven `result.status` values -- `SUCCESS`, `ERROR`,
 * `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING` -- and this
 * adapter used to read exactly one of them, collapsing the rest into a single
 * `status !== 'SUCCESS'` failure. The collapse was wrong in both directions:
 * a cancellation is not a turn failure, and `WAITING`/`RUNNING` in the one
 * event documented to be terminal means the turn has NOT settled, which is
 * the opposite of the completed failure it was reported as.
 *
 * These tests pin the mapping and the one behaviour that did NOT change with
 * it: every non-success settlement still abandons the live conversation.
 * That is deliberate and probed rather than inherited -- on real `agy 1.1.25`
 * neither reachable way to cut a turn short (a `--print-timeout` expiry, a
 * SIGINT) produces `CANCELED` at all; both report `ERROR` and leave the child
 * unusable (`docs/verification/agy-cli-contract.md`, finding 13). So the
 * classification fixes what a settlement is reported as, and deliberately
 * does not spend a live conversation on a state nothing can currently emit.
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

/** A live stream-json child that answers one `result` per NDJSON line and stays up. */
function liveChild(reply: Record<string, unknown>) {
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
      stdout.write(`${JSON.stringify({ event: 'result', result: stamped(reply, line) })}\n`)
      cut = buffer.indexOf('\n')
    }
  })
  return {
    pid: 4100,
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
    pid: 3100,
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

/** A context whose every turn spawn returns a fresh child, recording the spawns. */
function ctxFor(reply: Record<string, unknown>) {
  const spawns: string[][] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (isVersionSpawn(spec.argv)) return versionChild()
        if (spec.argv.includes('models')) return catalogChild()
        spawns.push([...spec.argv])
        return liveChild(reply)
      },
    },
  } as any
  return { ctx, spawns }
}

let messageSeq = 0
function userText(text: string) {
  messageSeq += 1
  return { id: `m${messageSeq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } as any
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'antigravity-cli',
    model: 'gemini-3.7-flash-low',
    sessionId: 'session-settlement',
    system: 'be useful',
    messages: [userText('do the thing')],
    ...overrides,
  } as any
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line no-unused-vars
  for await (const _chunk of iterable) { /* consume to completion */ }
}

/**
 * The whole mapping, including both ends of what the old boolean got wrong.
 *
 * `WEIRD` and a result with no `status` at all stand for a vendor addition
 * and a malformed envelope: an ending this adapter cannot name, over input
 * the vendor has already consumed, must report as a failure rather than
 * anything softer.
 */
const SETTLEMENTS: ReadonlyArray<{
  readonly status: string | undefined
  readonly code: string
  readonly phrase: RegExp
}> = [
  { status: 'ERROR', code: 'ANTIGRAVITY_CLI', phrase: /turn failed \(status ERROR\)/ },
  { status: 'INVALID', code: 'ANTIGRAVITY_CLI', phrase: /turn failed \(status INVALID\)/ },
  { status: 'CANCELED', code: 'ABORTED', phrase: /turn was cancelled \(status CANCELED\)/ },
  { status: 'INTERRUPTED', code: 'ABORTED', phrase: /turn was cancelled \(status INTERRUPTED\)/ },
  { status: 'WAITING', code: 'ANTIGRAVITY_PROTOCOL', phrase: /turn did not settle \(status WAITING\)/ },
  { status: 'RUNNING', code: 'ANTIGRAVITY_PROTOCOL', phrase: /turn did not settle \(status RUNNING\)/ },
  { status: 'WEIRD', code: 'ANTIGRAVITY_CLI', phrase: /turn failed \(status WEIRD\)/ },
  { status: undefined, code: 'ANTIGRAVITY_CLI', phrase: /turn failed \(status undefined\)/ },
]

for (const settlement of SETTLEMENTS) {
  const label = settlement.status ?? 'no status at all'
  test(`a turn settling as ${label} reports ${settlement.code}`, async () => {
    const { ctx } = ctxFor({
      conversation_id: 'c1',
      ...(settlement.status === undefined ? {} : { status: settlement.status }),
    })
    const adapter = new AntigravityCliAdapter(ctx, primaryConfig, noopQuotaHarvestCache())
    try {
      await assert.rejects(drain(adapter.stream(request())), (error: unknown) => {
        assert.ok(error instanceof LlmError)
        assert.equal(error.code, settlement.code)
        assert.match(error.message, settlement.phrase)
        // Every kind still routes through the VendorFailure contract: a
        // cancellation is reported differently, not reported less safely.
        assert.ok(error.cause instanceof VendorFailure)
        assert.equal(error.cause.stage, 'turn')
        return true
      })
    } finally { await adapter.dispose() }
  })
}

test('a cancelled turn does not leak the vendor error text it carries', async () => {
  const marker = '/home/secret-user/private token=agy_fake_sk_0011'
  const { ctx } = ctxFor({ conversation_id: 'c1', status: 'CANCELED', error: marker })
  const adapter = new AntigravityCliAdapter(ctx, primaryConfig, noopQuotaHarvestCache())
  try {
    await assert.rejects(drain(adapter.stream(request())), (error: unknown) => {
      assert.ok(error instanceof LlmError)
      assert.equal(error.code, 'ABORTED')
      assert.ok(!error.message.includes(marker), 'vendor-authored text must not reach the message')
      return true
    })
  } finally { await adapter.dispose() }
})

/**
 * The behaviour the classification deliberately left alone.
 *
 * A second request for the same DSH session must spawn a second child: the
 * vendor is holding a turn DSH refused, `sentDigests` already recorded it,
 * and a delta on top would ask the model to continue an exchange only one
 * side believes in.
 */
for (const status of ['ERROR', 'CANCELED', 'WAITING'] as const) {
  test(`a ${status} turn abandons the live conversation`, async () => {
    const { ctx, spawns } = ctxFor({ conversation_id: 'c1', status })
    const adapter = new AntigravityCliAdapter(ctx, primaryConfig, noopQuotaHarvestCache())
    try {
      await assert.rejects(drain(adapter.stream(request())))
      assert.equal(spawns.length, 1)
      await assert.rejects(drain(adapter.stream(request())))
      assert.equal(spawns.length, 2, `expected the ${status} turn to abandon its conversation`)
    } finally { await adapter.dispose() }
  })
}
