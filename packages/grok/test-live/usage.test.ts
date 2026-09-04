import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { GrokUsageBillingSource } from '../src/usage-billing.js'
import { GrokUsageCollector } from '../src/usage.js'

/**
 * Does ACP `_x.ai/billing` still answer on the real CLI, with no turn?
 *
 * Finding 8 of `docs/verification/grok-cli-contract.md` was right that
 * `grok -p "/usage"` is not a quota channel. Finding 18 is the one that
 * actually serves Usage & Limits: after `initialize`, `_x.ai/billing`
 * returns a credit percentage and an open period. That is a vendor
 * extension, so a release that renamed it would go quietly unavailable.
 *
 * Deliberately asserts the capability rather than a figure: how much of the
 * week is left is the account's business and changes between runs.
 *
 * Run with: `pnpm test:live:usage`. No turn, no tokens.
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
      if (name === 'cmd.exe') return process.env.COMSPEC || 'cmd.exe'
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
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => {
        child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
      })
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: {},
        done,
        terminate() { child.kill() },
        async waitForExit() { await done; return true },
      }
    },
  }
  ;(ctx as any).subprocess = subprocess
  return ctx
}

test('GROK USAGE: ACP _x.ai/billing produces a renderable snapshot with no turn', { timeout: 30_000 }, async () => {
  assert.ok(findOnPath('grok'), 'grok must be on PATH for the live usage suite')
  const ctx = createTestContext()
  const source = new GrokUsageBillingSource(ctx as any, {
    executable: 'grok',
    env: {},
    disposeGraceMs: 2_000,
    timeoutMs: 20_000,
    minIntervalMs: 0,
  })
  const snapshot = await new GrokUsageCollector(source).collect(Date.now())

  assert.equal(snapshot.providerId, 'grok')
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|stderr|auth\.json/i)
  assert.equal(snapshot.status, 'AVAILABLE')
  assert.ok(snapshot.windows.length >= 1, 'billing must publish at least one open credit window')
  const [window] = snapshot.windows
  assert.equal(typeof window.usedPercent, 'number')
  assert.ok(window.usedPercent! >= 0 && window.usedPercent! <= 100)
  assert.ok(window.kind === 'WEEKLY' || window.kind === 'SHORT' || window.kind === 'OTHER')
})
