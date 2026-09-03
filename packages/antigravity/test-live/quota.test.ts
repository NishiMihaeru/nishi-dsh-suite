import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createAntigravityPrimaryAdapter } from '../src/antigravity-primary.js'
import { AntigravityOwnChildQuotaSource, AntigravityQuotaHarvestCache } from '../src/quota-harvest-cache.js'
import { createHostPlatformDiscovery } from '../src/usage-source.js'
import { AntigravityUsageCollector } from '../src/usage.js'

/**
 * Does the narrowed quota path produce a number at all?
 *
 * This route used to find quota by scanning every process on the machine for
 * something Antigravity-shaped and lifting a CSRF token out of its command
 * line. That was removed; the only reading left is harvested from the `agy`
 * child this package spawns for a turn, on loopback ports resolved from that
 * one pid. Nothing in the focused suite can tell whether a REAL vendor child
 * exposes such a listener at all, or whether the private RPC still answers on
 * it, and the whole capability is best-effort by construction -- so without
 * this suite the difference between "narrowed" and "quietly dead" is
 * invisible.
 *
 * Deliberately asserts the capability rather than a figure: which pools exist
 * and how much is left of them is the account's business and changes between
 * runs. What is asserted is that a turn produces a cached reading, and that
 * the collector turns it into an AVAILABLE snapshot with at least one window
 * a consumer could render -- a labelled `usedPercent` in range, which is the
 * shape the collector converts the vendor's remaining fraction into.
 *
 * Run with: `pnpm test:live:quota`. One turn on the cheapest model.
 */

function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || ''
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of pathEnv.split(process.platform === 'win32' ? ';' : ':')) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function createTestContext() {
  const ctx = new Context()
  new LlmRuntime(ctx)
  const subprocess = {
    async resolveExecutable(name: string) {
      return findOnPath(name) ?? name
    },
    spawn(spec: any) {
      const [cmd, ...args] = spec.argv
      const child = spawn(cmd, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: [spec.stdio?.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', chunk => { stderr += chunk })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => {
        child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
      })
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: {
          stdout: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
          stderr: { readFrom() { return { text: stderr, nextOffset: stderr.length, lossy: false } } },
        },
        done,
        terminate() { child.kill() },
        async waitForExit() { await done; return true },
      }
    },
  }
  ;(ctx as any).subprocess = subprocess
  return ctx
}

const config = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 30_000,
  turnTimeoutMs: 180_000,
  disposeGraceMs: 2_000,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  sessionIdleMs: 120_000,
}

test('ANTIGRAVITY QUOTA: a real turn harvests a quota reading from its own child', async () => {
  const platformDiscovery = createHostPlatformDiscovery()
  const cache = new AntigravityQuotaHarvestCache({
    discoverListeners: pid => platformDiscovery.discoverListeners(pid),
  })
  const ctx = createTestContext()
  const adapter = createAntigravityPrimaryAdapter(ctx as any, config as any, cache)

  try {
    // The harvest is fire-and-forget from inside the turn, so the turn itself
    // is ordinary: one cheap question, no tools.
    const options = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 'live-quota' as any,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply with the single word: ready.' }] })],
    } as unknown as GenerateOptions

    for await (const _chunk of adapter.stream(options)) { /* drain */ }

    // The harvest races the turn deliberately -- it must never delay one -- so
    // give its bounded retry loop a moment to land before reading.
    for (let waited = 0; waited < 5_000 && cache.read() === undefined; waited += 250) {
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    const harvested = cache.read()
    assert.ok(
      harvested,
      'no quota reading was harvested from the turn\'s own agy child: either the child exposes no '
      + 'loopback listener, or the RetrieveUserQuotaSummary RPC no longer answers on it. The whole '
      + 'usage capability on this route is that reading.',
    )

    const snapshot = await new AntigravityUsageCollector(new AntigravityOwnChildQuotaSource(cache)).collect(1)
    assert.equal(snapshot.status, 'AVAILABLE', `collector did not serve the harvested reading: ${JSON.stringify(snapshot)}`)
    assert.ok(snapshot.windows.length > 0, 'an AVAILABLE snapshot with no window is not a reading')
    // The normalized window reports consumption as a percentage, not the
    // vendor's own remaining fraction: the collector converts. Asserting the
    // shape the CONSUMER sees is the point -- a window the browser surface
    // cannot render is not a working capability.
    const window = snapshot.windows[0] as any
    assert.ok(
      typeof window.usedPercent === 'number' && window.usedPercent >= 0 && window.usedPercent <= 100,
      `window carries no usable usedPercent: ${JSON.stringify(window)}`,
    )
    assert.ok(typeof window.label === 'string' && window.label.length > 0, 'window has no label to show')
    console.log(
      `[quota] ${snapshot.windows.length} window(s); first: ${window.label} `
      + `usedPercent=${window.usedPercent} kind=${window.kind}`,
    )
  } finally {
    await adapter.dispose()
  }
})
