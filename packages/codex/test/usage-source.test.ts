import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { CodexRateLimitsSourceError, CodexUsageCollector } from '../src/usage.ts'
import {
  codexAppServerArgv,
  DEFAULT_REQUEST_TIMEOUT_MS,
  OfficialCodexRateLimitsSource,
} from '../src/usage-source.ts'

interface FakeAppServerOptions {
  readonly loggedIn?: boolean
  readonly version?: string
  readonly observations?: { terminateCalls: number; waitSignals: Array<AbortSignal | undefined> }
}

function fakeAppServerChild(options: FakeAppServerOptions = {}) {
  const { observations } = options
  const loggedIn = options.loggedIn ?? true
  const version = options.version ?? '0.150.0'
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
      const message = JSON.parse(line) as Record<string, unknown>
      if (message.method === 'initialize') {
        stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            userAgent: `deepseek-harness/${version} (Linux; x86_64) codex-cli`,
            codexHome: '/provider/codex-home',
            platformFamily: 'unix',
            platformOs: 'linux',
          },
        })}\n`)
      } else if (message.method === 'account/read') {
        stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: loggedIn
            ? { requiresOpenaiAuth: true, account: { type: 'chatgpt' } }
            : { requiresOpenaiAuth: true, account: null },
        })}\n`)
      } else if (message.method === 'account/rateLimits/read') {
        stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { primary: { usedPercent: 17 } },
        })}\n`)
      }
    }
  })

  const finish = () => {
    if (settled) return
    settled = true
    resolveDone({ exitCode: 0, signal: null })
  }

  return {
    pid: 4242,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate() {
      if (observations) observations.terminateCalls += 1
      finish()
    },
    async waitForExit(signal?: AbortSignal) {
      observations?.waitSignals.push(signal)
      await done
      return true
    },
  } as any
}

test('external executable uses only the official app-server stdio command', () => {
  assert.deepEqual(codexAppServerArgv('/vendor/codex'), [
    '/vendor/codex',
    'app-server',
    '--stdio',
  ])
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 30_000)
})

test('usage source resolves and launches Codex in the DSH subprocess execution world', async () => {
  const env = {
    DSH_CODEX_EXECUTABLE: 'provider-codex',
    CODEX_HOME: '/provider/codex-home',
    PATH: '/provider/bin',
  }
  const resolved: Array<{ command: string; env: Readonly<Record<string, string>> | undefined; signal: AbortSignal | undefined }> = []
  const spawned: any[] = []
  const observations = { terminateCalls: 0, waitSignals: [] as Array<AbortSignal | undefined> }

  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    executable: 'provider-codex',
    env,
    async resolveExecutable(command, receivedEnv, signal) {
      resolved.push({ command, env: receivedEnv, signal })
      return '/provider/runtime/codex'
    },
    spawn(spec) {
      spawned.push(spec)
      return fakeAppServerChild({ observations })
    },
  })

  const result = await source.read()
  assert.deepEqual(result, { primary: { usedPercent: 17 } })
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0]?.command, 'provider-codex')
  assert.deepEqual(resolved[0]?.env, env)
  assert.ok(resolved[0]?.signal instanceof AbortSignal)

  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].argv, ['/provider/runtime/codex', 'app-server', '--stdio'])
  assert.deepEqual(spawned[0].env, env, 'the subprocess provider, not Codex usage, owns parent-env construction')
  assert.equal(spawned[0].cwd, '/provider/workspace')
  assert.equal(observations.terminateCalls, 1)
  assert.deepEqual(observations.waitSignals, [undefined], 'cleanup must wait for whole-tree exit without a grace-bound abort')
})

test('usage source rejects a Codex App Server older than the audited runtime, and accepts a newer one', async () => {
  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { return '/provider/runtime/codex' },
    spawn() { return fakeAppServerChild({ version: '0.149.0' }) },
  })

  await assert.rejects(source.read(), /unsupported Codex App Server version.*0\.149\.0.*0\.150\.0 or newer/)

  // The other direction, and the point of the change: a vendor upgrade past
  // the audited runtime must not take quota reporting down with it.
  const newer = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { return '/provider/runtime/codex' },
    spawn() { return fakeAppServerChild({ version: '0.151.0' }) },
  })
  await newer.read()
})

test('an unsupported Codex App Server version is UNAVAILABLE, not a bare collection ERROR', async () => {
  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { return '/provider/runtime/codex' },
    spawn() { return fakeAppServerChild({ version: '0.149.0' }) },
  })

  await assert.rejects(source.read(), (error: unknown) => {
    assert.ok(error instanceof CodexRateLimitsSourceError)
    assert.equal(error.code, 'UNAVAILABLE')
    return true
  })
})

test('the usage collector reports UNAVAILABLE, not ERROR, for an installed-but-unsupported Codex version', async () => {
  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { return '/provider/runtime/codex' },
    spawn() { return fakeAppServerChild({ version: '0.149.0' }) },
  })

  const snapshot = await new CodexUsageCollector(source).collect(1234)
  assert.equal(snapshot.status, 'UNAVAILABLE')
  assert.deepEqual(snapshot.windows, [])
})

test('usage source reports missing vendor login as LOGIN_REQUIRED before reading limits', async () => {
  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { return '/provider/runtime/codex' },
    spawn() { return fakeAppServerChild({ loggedIn: false }) },
  })

  await assert.rejects(source.read(), (error: unknown) => {
    assert.ok(error instanceof CodexRateLimitsSourceError)
    assert.equal(error.code, 'LOGIN_REQUIRED')
    return true
  })
})

test('usage source classifies executable resolution failure as UNAVAILABLE without leaking raw details', async () => {
  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { throw new Error('/secret/vendor/path/codex missing') },
    spawn() { throw new Error('spawn must not be reached') },
  })

  await assert.rejects(source.read(), (error: unknown) => {
    assert.ok(error instanceof CodexRateLimitsSourceError)
    assert.equal(error.code, 'UNAVAILABLE')
    assert.doesNotMatch(error.message, /secret|vendor\/path/)
    return true
  })
})

test('the usage probe captures vendor stderr instead of inheriting the host stream', async () => {
  // `stderr: 'inherit'` wrote raw vendor stderr straight to the host process's
  // own stderr -- credential paths and network diagnostics included -- which was
  // the one place in this package where vendor-authored text reached a human
  // unscrubbed. The bytes need somewhere to go that is not the operator's
  // console; nothing reads them on the success path.
  const spawned: any[] = []
  const source = new OfficialCodexRateLimitsSource({
    cwd: '/provider/workspace',
    async resolveExecutable() { return '/provider/runtime/codex' },
    spawn(spec: any) {
      spawned.push(spec)
      return fakeAppServerChild({})
    },
  } as any)

  await source.read().catch(() => { /* the probe's own outcome is not the subject */ })

  assert.equal(spawned.length, 1)
  assert.notEqual(spawned[0].stdio.stderr, 'inherit')
  assert.equal(typeof spawned[0].stdio.stderr, 'object')
  assert.ok(
    typeof spawned[0].stdio.stderr.maxBytes === 'number' && spawned[0].stdio.stderr.maxBytes > 0,
    'captured stderr must be bounded',
  )
})
