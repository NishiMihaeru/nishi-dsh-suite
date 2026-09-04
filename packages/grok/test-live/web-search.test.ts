import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { GrokSearchBackend } from '../src/web-search-backend.ts'

/**
 * Live native-search probe for the Grok backend, against the real `grok`
 * binary. Asserts structured sources came back, which the unit suite cannot:
 * the parser is pinned against a recorded stream, and only the vendor can
 * decide whether `web_search` actually ran.
 *
 * Spends one search turn. Run with `pnpm test:live:web-search`. Do not point
 * `DSH_LIVE_GROK_MODEL` at `grok-4.6` for this suite.
 */

const LIVE_MODEL = process.env.DSH_LIVE_GROK_MODEL ?? 'grok-4.5'
const LIVE_EFFORT = process.env.DSH_LIVE_GROK_EFFORT ?? 'low'

if (LIVE_MODEL === 'grok-4.6') {
  throw new Error(
    'test-live/web-search.test.ts spends quota; grok-4.6 is not the model for this suite. '
    + 'Unset DSH_LIVE_GROK_MODEL or set it to grok-4.5.',
  )
}

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

function liveCtx(): any {
  return {
    subprocess: {
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
          stdio: [spec.stdio?.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        })
        let collectedStdout = ''
        let collectedStderr = ''
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => { collectedStdout += chunk })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => { collectedStderr += chunk })
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
            stdout: { readFrom() { return { text: collectedStdout } } },
            stderr: { readFrom() { return { text: collectedStderr } } },
          },
          done,
          terminate() { child.kill() },
          async waitForExit() { await done.catch(() => {}); return true },
        }
      },
    },
  }
}

test('GROK WEB SEARCH LIVE: native web_search returns structured sources', { timeout: 180_000 }, async () => {
  assert.ok(findOnPath('grok'), 'grok must be installed and available on PATH')
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const raw = await new GrokSearchBackend(liveCtx(), {
      executable: 'grok',
      env: {},
      timeoutMs: 120_000,
      disposeGraceMs: 3_000,
      stderrMaxBytes: 64_000,
    }).search(
      { provider: 'grok-cli', model: LIVE_MODEL, reasoningEffort: LIVE_EFFORT },
      { query: `Node.js official website ${Date.now()}`, maxResults: 8 },
      AbortSignal.timeout(120_000),
    ) as { sources?: unknown[] }
    assert.ok(Array.isArray(raw?.sources))
    assert.ok((raw.sources?.length ?? 0) > 0)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})
