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
      const done = new Promise<any>((resolveDone, rejectDone) => { child.once('error', rejectDone); child.once('close', (exitCode, signal) => resolveDone({ exitCode, signal })) })
      return {
        pid: child.pid ?? 0, stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
        collected: { stdout: undefined, stderr: { readFrom() { return { text: stderr } } } },
        done, terminate() { child.kill() }, async waitForExit() { await done.catch(() => {}); return true },
      }
    },
  }
}

test('ANTIGRAVITY SUBAGENT LIVE: official agy sees workspace and DSH memory', async () => {
  assert.ok(findOnPath('agy'), 'agy must be installed and available on PATH')
  const io = subprocess()
  const sentinel = `AGY-MEMORY-${Date.now()}`
  const signal = new AbortController().signal
  const run = await startAntigravitySubagentRun({
    prompt: [{ type: 'text', text: 'Read the repository root package.json. Reply with its package name and the exact memory sentinel.' }],
    parent: { session: { header: { cwd: REPO_ROOT } } },
    signal,
  } as any, {
    cwd: REPO_ROOT,
    executable: 'agy', env: {},
    model: process.env.DSH_LIVE_ANTIGRAVITY_MODEL || 'gemini-3.7-flash-medium',
    effort: process.env.DSH_LIVE_ANTIGRAVITY_EFFORT || 'medium',
    turnTimeoutMs: 120_000, disposeGraceMs: 3_000, stderrMaxBytes: 64_000,
    projectMemory: { bootstrap: `# DSH Project Context\nSUBAGENT_SENTINEL = ${sentinel}`, async read(topic: string) { return { topic, exists: false, content: null } } },
    resolveExecutable: io.resolveExecutable,
    spawn: io.spawn,
  } as any)
  try {
    const result = await run.result
    const text = result.output.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    assert.equal(result.stopReason, 'completed')
    assert.match(text, /nishi-dsh-suite-workspace/)
    assert.ok(text.includes(sentinel))
  } finally {
    await run.dispose()
  }
})
