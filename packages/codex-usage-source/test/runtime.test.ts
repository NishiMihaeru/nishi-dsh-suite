import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { OfficialCodexRateLimitsSource } from '../src/index.ts'

function fakeAppServerChild() {
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
          result: { serverInfo: { name: 'codex', version: '0.150.0' } },
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
    terminate: finish,
    async waitForExit() {
      await done
      return true
    },
  } as any
}

test('usage source resolves external Codex and launches app-server directly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nishi-codex-usage-runtime-'))
  const executable = join(root, 'codex')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)

  const spawned: any[] = []
  try {
    const source = new OfficialCodexRateLimitsSource({
      cwd: root,
      env: {
        DSH_CODEX_EXECUTABLE: executable,
        PATH: '/usr/bin',
      },
      spawn(spec) {
        spawned.push(spec)
        return fakeAppServerChild()
      },
    })

    const result = await source.readRateLimits()
    assert.deepEqual(result, { primary: { usedPercent: 17 } })
    assert.equal(spawned.length, 1)
    assert.deepEqual(spawned[0].argv, [executable, 'app-server', '--stdio'])
    assert.equal(spawned[0].argv.includes(process.execPath), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
