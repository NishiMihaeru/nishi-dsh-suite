import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { runSuiteCli } from '../src/cli.js'

function capture() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  }
}

test('preset status reports absent without treating it as a CLI failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nishi-dsh-suite-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = capture()

  const code = await runSuiteCli(['preset', 'status'], {
    env: { DSH_HOME: root },
    ...output.io,
  })

  assert.equal(code, 0)
  assert.match(output.stdout.join('\n'), /orchestrator preset: absent/i)
  assert.equal(output.stderr.length, 0)
})

test('unknown preset action is a usage error', async () => {
  const output = capture()
  const code = await runSuiteCli(['preset', 'wat'], output.io)

  assert.equal(code, 2)
  assert.match(output.stderr.join('\n'), /usage:/i)
})

test('top-level help documents all four preset lifecycle commands', async () => {
  const output = capture()
  const code = await runSuiteCli(['--help'], output.io)

  assert.equal(code, 0)
  const text = output.stdout.join('\n')
  for (const action of ['install', 'status', 'update', 'remove']) {
    assert.match(text, new RegExp(`preset ${action}`))
  }
})
