import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexSearchBackend } from '../src/web-search-backend.ts'
import { normalizeProviderResult } from 'nishi-dsh-core/web-search'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH || '').split(':')) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

// CodexSearchBackend spawns through the DSH subprocess service. The live suite
// therefore needs a real cordis-shaped ctx, not a bare constructor call.
function liveCtx(): any {
  return {
    subprocess: {
      async resolveExecutable(name: string) { return findOnPath(name) ?? name },
      spawn(spec: any) {
        const [command, ...args] = spec.argv
        const child = spawn(command, args, {
          cwd: spec.cwd,
          env: { ...process.env, ...spec.env },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        let stderr = ''
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk) => { stderr += chunk })
        const done = new Promise<any>((resolveDone, rejectDone) => {
          child.once('error', rejectDone)
          child.once('close', (exitCode, signal) => resolveDone({ exitCode, signal }))
        })
        if (spec.signal) spec.signal.addEventListener('abort', () => child.kill(), { once: true })
        return {
          pid: child.pid ?? 0, stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
          collected: { stdout: undefined, stderr: { readFrom() { return { text: stderr } } } },
          done, terminate() { child.kill() }, async waitForExit() { await done.catch(() => {}); return true },
        }
      },
    },
  }
}


test('PRIMARY WEB SEARCH LIVE: Codex backend composes without DeepSeek fallback', async () => {
  const model = process.env.DSH_LIVE_CODEX_SEARCH_MODEL?.trim()
  assert.ok(model, 'Set DSH_LIVE_CODEX_SEARCH_MODEL')
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const raw = await new CodexSearchBackend(liveCtx()).search(
      { provider: 'codex-app-server', model },
      { query: `OpenAI Codex SDK official documentation ${Date.now()}`, maxResults: 8 },
      AbortSignal.timeout(120_000),
    )
    const result = normalizeProviderResult(raw, 8)
    assert.ok(result.sources.length > 0)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})
