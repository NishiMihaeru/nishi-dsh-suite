import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { AntigravitySearchBackend } from '../src/web-search-backend.ts'
import { normalizeProviderResult } from 'nishi-dsh-core/web-search'

function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || ''
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of pathEnv.split(process.platform === 'win32' ? ';' : ':')) for (const ext of exts) {
    const candidate = join(dir, name + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function subprocess() {
  return {
    async resolveExecutable(name: string) {
      if (name === 'cmd.exe') return process.env.COMSPEC || 'cmd.exe'
      return findOnPath(name) ?? name
    },
    spawn(spec: any) {
      const [command, ...args] = spec.argv
      const child = spawn(command, args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', chunk => { stderr += chunk })
      const done = new Promise<any>((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })) })
      if (spec.signal) spec.signal.addEventListener('abort', () => child.kill(), { once: true })
      return { pid: child.pid ?? 0, stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, collected: { stdout: undefined, stderr: { readFrom() { return { text: stderr } } } }, done, terminate() { child.kill() }, async waitForExit() { await done.catch(() => {}); return true } }
    },
  }
}

test('PRIMARY WEB SEARCH LIVE: Antigravity backend composes without DeepSeek fallback', async () => {
  assert.ok(findOnPath('agy'), 'agy must be installed')
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const backend = new AntigravitySearchBackend({ subprocess: subprocess() } as any, { executable: 'agy', env: {}, timeoutMs: 120_000, disposeGraceMs: 3_000, stderrMaxBytes: 64_000 })
    const raw = await backend.search(
      { provider: 'antigravity-cli', model: process.env.DSH_LIVE_ANTIGRAVITY_MODEL || 'gemini-3.7-flash-medium', reasoningEffort: process.env.DSH_LIVE_ANTIGRAVITY_EFFORT || 'medium' },
      { query: `Google Antigravity official documentation ${Date.now()}`, maxResults: 8 },
      AbortSignal.timeout(120_000),
    )
    const result = normalizeProviderResult(raw, 8)
    assert.ok(result.sources.length > 0)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})
