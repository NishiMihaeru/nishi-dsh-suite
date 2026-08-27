import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  claudeUsageCliArgv,
  DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  OfficialClaudeUsageSource,
} from '../src/runtime/claude-usage.ts'

function fakeUsageChild(received: any[], emitInit = true) {
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

  if (emitInit) {
    queueMicrotask(() => {
      stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'usage-fixture' })}\n`)
    })
  }

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
  assert.equal(DEFAULT_USAGE_REQUEST_TIMEOUT_MS, 30_000)
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

    const usage = await source.read()
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

// Regression guard for a live protocol drift the unit fixtures had encoded away.
// read() used to withhold the control request until it saw a system/init
// line, and the fixture obligingly emitted one. Claude CLI 2.1.246 emits nothing
// on stdout until it receives stdin input, so against the real CLI that wait
// deadlocked until the request timeout while every unit test stayed green.
test('usage request does not wait for a system/init line that never arrives', { timeout: 2_000 }, async () => {
  const received: any[] = []
  const source = new OfficialClaudeUsageSource({
    cwd: '/tmp',
    executable: '/vendor/claude',
    spawn: () => fakeUsageChild(received, false),
  } as any)

  const usage = await source.read()
  assert.equal((usage as any).rate_limits_available, true)
  assert.equal(received.length, 1)
  assert.equal(received[0].type, 'control_request')
  assert.equal(received[0].request.subtype, 'get_usage')
})
