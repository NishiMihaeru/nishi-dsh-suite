import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { AntigravityUsageCommandSource } from '../src/usage-command.js'
import { AntigravityUsageCollector } from '../src/usage.js'

/**
 * Does the PUBLISHED quota channel answer on the real CLI, and is it still
 * free?
 *
 * This route used to reach quota through a private RPC of the vendor's
 * language server: a `/proc` descendant walk, socket inodes matched against
 * `/proc/net/tcp`, and a PID-scoped trust boundary invented to make reading
 * an undocumented loopback port defensible. All of it is gone, replaced by
 * `agy -p "/usage" --output-format json` (`agy-cli-contract.md`, finding 17).
 *
 * Two things need a live check, and neither is visible to the focused suite.
 *
 * **That the command still answers.** It is a slash command intercepted
 * client-side in print mode, which is a vendor behaviour rather than a
 * documented API shape; if a release stopped answering it headless, the
 * capability would go quietly unavailable and nothing else would notice.
 *
 * **That it still costs nothing.** The whole argument for reading quota on
 * demand -- rather than only while a turn is already running -- is that this
 * command bills no tokens and starts no conversation. That is a measured
 * property of the vendor, not a guarantee, so it is asserted rather than
 * assumed: `num_turns` at zero and every usage counter at zero.
 *
 * Deliberately asserts the capability rather than a figure: which pools exist
 * and how much is left of them is the account's business and changes between
 * runs.
 *
 * Run with: `pnpm test:live:quota`. No turn, no tokens.
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
      let stdout = ''
      let stderr = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', chunk => { stdout += chunk })
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
          stdout: { readFrom() { return { text: stdout, nextOffset: stdout.length, lossy: false } } },
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

const sourceConfig = { executable: 'agy', env: {}, disposeGraceMs: 2_000 }

test('ANTIGRAVITY QUOTA: the published /usage command produces a renderable snapshot with no turn', async () => {
  const ctx = createTestContext()
  const source = new AntigravityUsageCommandSource(ctx as any, sourceConfig)
  const started = Date.now()
  const snapshot = await new AntigravityUsageCollector(source).collect(Date.now())
  const elapsed = Date.now() - started

  assert.equal(snapshot.status, 'AVAILABLE')
  assert.ok(snapshot.windows.length > 0, 'the published channel returned no window a consumer could render')

  for (const window of snapshot.windows) {
    assert.ok(Number.isFinite(window.usedPercent), `window ${window.id} carries no finite usedPercent`)
    assert.ok(window.usedPercent >= 0 && window.usedPercent <= 100, `window ${window.id} out of range`)
    assert.ok(window.label.length > 0, `window ${window.id} has no label`)
    // The pool name is the vendor's own group, not a cadence-stripped guess
    // at one -- that is the display improvement this transport brought, and
    // a regression to "gemini" would show up right here.
    assert.equal(window.scope.kind, 'BUCKET')
    assert.ok((window.scope.label ?? '').length > 0, `window ${window.id} has an unnamed pool`)
  }

  const pools = new Set(snapshot.windows.map(w => w.scope.id))
  const ids = snapshot.windows.map(w => w.id)
  assert.equal(new Set(ids).size, ids.length, 'two windows shared an id; cadences must stay distinct')

  console.log(
    `[quota] ${snapshot.windows.length} window(s) across ${pools.size} pool(s) in ${elapsed}ms; `
    + `first: ${snapshot.windows[0].scope.label} / ${snapshot.windows[0].label} `
    + `usedPercent=${snapshot.windows[0].usedPercent.toFixed(2)}`,
  )
})

test('ANTIGRAVITY QUOTA: the reading is free -- no turn, no tokens, no conversation', async () => {
  const agy = findOnPath('agy') ?? 'agy'
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(agy, ['-p', '/usage', '--output-format', 'json'], { windowsHide: true })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { out += chunk })
    child.on('error', reject)
    child.on('close', () => resolve(out))
  })

  const envelope = JSON.parse(stdout) as Record<string, any>
  assert.equal(envelope.status, 'SUCCESS')
  assert.equal(envelope.num_turns, 0, 'the slash command started an agent turn; it is no longer free')
  assert.equal(envelope.conversation_id, '', 'the slash command left a conversation behind')
  for (const [field, value] of Object.entries(envelope.usage ?? {})) {
    assert.equal(value, 0, `the slash command billed ${field}`)
  }
  assert.equal(envelope.command?.name, 'usage')
  assert.ok(Array.isArray(envelope.command?.data?.groups), 'the payload no longer carries groups')
})
