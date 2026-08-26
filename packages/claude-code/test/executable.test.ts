import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveClaudeExecutable } from '../src/executable.ts'

test('explicit DSH_CLAUDE_EXECUTABLE wins over PATH', () => {
  const result = resolveClaudeExecutable({
    env: { DSH_CLAUDE_EXECUTABLE: '/opt/claude/bin/claude', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/opt/claude/bin/claude',
    platform: 'linux',
  })

  assert.equal(result.executable, '/opt/claude/bin/claude')
  assert.equal(result.source, 'override')
})

test('PATH resolves claude when no override is set', () => {
  const result = resolveClaudeExecutable({
    env: { PATH: '/usr/local/bin:/usr/bin' },
    isExecutable: (path) => path === '/usr/local/bin/claude',
    platform: 'linux',
  })

  assert.equal(result.executable, '/usr/local/bin/claude')
  assert.equal(result.source, 'path')
})

test('invalid override fails closed and never falls back to PATH', () => {
  assert.throws(
    () => resolveClaudeExecutable({
      env: { DSH_CLAUDE_EXECUTABLE: '/missing/claude', PATH: '/usr/local/bin' },
      isExecutable: (path) => path === '/usr/local/bin/claude',
      platform: 'linux',
    }),
    /configured Claude executable is not executable/,
  )
})

test('missing Claude yields a stable actionable diagnostic', () => {
  assert.throws(
    () => resolveClaudeExecutable({
      env: { PATH: '/usr/bin' },
      isExecutable: () => false,
      platform: 'linux',
    }),
    /Claude CLI is unavailable/,
  )
})

test('Windows PATH lookup uses claude.exe', () => {
  const result = resolveClaudeExecutable({
    env: { PATH: 'C:\\Tools;C:\\Windows\\System32' },
    isExecutable: (path) => path === 'C:\\Tools\\claude.exe',
    platform: 'win32',
  })

  assert.equal(result.executable, 'C:\\Tools\\claude.exe')
  assert.equal(result.source, 'path')
})
