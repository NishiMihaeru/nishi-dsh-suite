import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { startAntigravitySubagentRun } from '../src/antigravity-subagent.ts'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..')

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
        collected: { stdout: undefined, stderr: { readFrom() { return { text: stderr } } } },
        done,
        terminate() { child.kill() },
        async waitForExit() { await done.catch(() => {}); return true },
      }
    },
  }
}

test('ANTIGRAVITY SUBAGENT PRODUCTION: official cached-login agy can inspect workspace and receive DSH memory', async () => {
  assert.ok(findOnPath('agy'), 'agy must be installed and available on PATH')
  const subprocess = realSubprocess()
  const controller = new AbortController()
  const sentinel = `AGY-MEMORY-${Date.now()}`
  const request = {
    prompt: [{
      type: 'text',
      text: 'Read the repository root package.json. Reply with the package name and the exact DSH memory sentinel, separated by one space.',
    }],
    parent: { session: { header: { cwd: REPO_ROOT } } },
    signal: controller.signal,
  } as any

  const run = await startAntigravitySubagentRun(request, {
    cwd: REPO_ROOT,
    executable: 'agy',
    env: {},
    model: process.env.DSH_LIVE_ANTIGRAVITY_MODEL || 'gemini-3.7-flash-medium',
    effort: (process.env.DSH_LIVE_ANTIGRAVITY_EFFORT || 'medium'),
    turnTimeoutMs: 120_000,
    disposeGraceMs: 3_000,
    stderrMaxBytes: 64_000,
    projectMemory: {
      bootstrap: `# DSH Project Context\n\n## Project Memory (.dsh/memory/MEMORY.md)\nSUBAGENT_SENTINEL = ${sentinel}`,
      async read(topic: string) { return { topic, exists: false, content: null } },
    },
    resolveExecutable: subprocess.resolveExecutable,
    spawn: subprocess.spawn,
  })

  try {
    const result = await run.result
    assert.equal(result.stopReason, 'completed')
    const text = result.output.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    assert.match(text, /nishi-dsh-suite-workspace/)
    assert.ok(text.includes(sentinel), `Expected memory sentinel ${sentinel}, got: ${text}`)
  } finally {
    await run.dispose()
  }
})
