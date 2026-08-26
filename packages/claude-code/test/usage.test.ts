import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  claudeUsageCliArgv,
  OfficialClaudeUsageSource,
} from '../src/usage.js'

function fakeUsageChild(received: any[]) {
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
      const message = JSON.parse(line)
      received.push(message)
      if (message.type === 'control_request' && message.request?.subtype === 'get_usage') {
        stdout.write(`${JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: message.request_id,
            response: {
              rate_limits_available: true,
              rate_limits: {
                five_hour: {
                  utilization: 17,
                  resets_at: '2026-08-27T05:00:00Z',
                },
              },
            },
          },
        })}\n`)
      }
    }
  })

  const settle = () => {
    if (settled) return
    settled = true
    resolveDone({ exitCode: null, signal: 'SIGTERM' })
  }

  queueMicrotask(() => {
    stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'usage-fixture' })}\n`)
  })

  return {
    pid: 5511,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate: settle,
    async waitForExit() {
      await done
      return true
    },
  } as any
}

test('Claude usage argv opens a stream-json control session without a model prompt', () => {
  assert.deepEqual(claudeUsageCliArgv('/usr/bin/claude'), [
    '/usr/bin/claude',
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--tools', '',
    '--strict-mcp-config',
  ])
})

test('Claude usage source asks the external CLI for get_usage without sending a user turn', { timeout: 2_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nishi-claude-usage-'))
  const executable = join(root, 'claude')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)

  const received: any[] = []
  const spawned: any[] = []
  try {
    const source = new OfficialClaudeUsageSource({
      cwd: root,
      env: {
        DSH_CLAUDE_EXECUTABLE: executable,
        PATH: '/usr/bin',
      },
      spawn(spec: any) {
        spawned.push(spec)
        return fakeUsageChild(received)
      },
    } as any)

    const usage = await source.getUsage()
    assert.deepEqual(usage, {
      rate_limits_available: true,
      rate_limits: {
        five_hour: {
          utilization: 17,
          resets_at: '2026-08-27T05:00:00Z',
        },
      },
    })
    assert.equal(spawned.length, 1)
    assert.deepEqual(spawned[0].argv, claudeUsageCliArgv(executable))
    assert.equal(received.some((message) => message.type === 'user'), false)
    assert.equal(received.filter((message) => message.type === 'control_request').length, 1)
    assert.equal(received[0]?.request?.subtype, 'get_usage')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
