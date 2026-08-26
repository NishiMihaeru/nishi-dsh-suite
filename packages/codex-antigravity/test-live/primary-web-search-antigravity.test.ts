import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { AntigravitySearchBackend } from '../src/primary-web-search/antigravity.ts'
import { normalizeProviderResult } from '../src/primary-web-search/result.ts'

function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || ''
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':')
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function realSubprocess() {
  return {
    async resolveExecutable(name: string) {
      if (name === 'cmd.exe') return process.env.COMSPEC || 'cmd.exe'
      return findOnPath(name) ?? name
    },
    spawn(spec: any) {
      const [command, ...args] = spec.argv
      const child = spawn(command, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', chunk => { stderr += chunk })
      const done = new Promise<any>((resolveDone, rejectDone) => {
        child.once('error', rejectDone)
        child.once('close', (exitCode, signal) => resolveDone({ exitCode, signal }))
      })
      if (spec.signal) spec.signal.addEventListener('abort', () => child.kill(), { once: true })
      return {
        pid: child.pid ?? 0,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: {
          stdout: undefined,
          stderr: { readFrom() { return { text: stderr } } },
        },
        done,
        terminate() { child.kill() },
        async waitForExit() { await done.catch(() => {}); return true },
      }
    },
  }
}

function withoutDeepSeekKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  return run().finally(() => {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  })
}

test('PRIMARY WEB SEARCH LIVE: Antigravity uses agy search_web without DEEPSEEK_API_KEY', async () => {
  assert.ok(findOnPath('agy'), 'agy must be installed and available on PATH')
  const subprocess = realSubprocess()
  const backend = new AntigravitySearchBackend(
    { subprocess } as any,
    {
      executable: 'agy',
      env: {},
      timeoutMs: 120_000,
      disposeGraceMs: 3_000,
      stderrMaxBytes: 64_000,
    },
  )
  const model = process.env.DSH_LIVE_ANTIGRAVITY_MODEL || 'gemini-3.7-flash-medium'
  const effort = process.env.DSH_LIVE_ANTIGRAVITY_EFFORT || 'medium'
  const raw = await withoutDeepSeekKey(() => backend.search(
    { provider: 'antigravity-cli', model, reasoningEffort: effort },
    {
      query: `Google Antigravity official documentation headless CLI ${Date.now()}`,
      maxResults: 8,
    },
    AbortSignal.timeout(120_000),
  ))
  const result = normalizeProviderResult(raw, 8)

  assert.ok(result.sources.length > 0, `Expected at least one agy search_web source, got ${JSON.stringify(result)}`)
  for (const source of result.sources) assert.match(source.url, /^https?:\/\//)
})
