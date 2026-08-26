import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCodexExecutable } from '../src/resolver.ts'

test('explicit DSH_CODEX_EXECUTABLE wins over PATH', () => {
  const result = resolveCodexExecutable({
    env: { DSH_CODEX_EXECUTABLE: '/opt/codex/bin/codex', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/opt/codex/bin/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/opt/codex/bin/codex')
  assert.equal(result.source, 'override')
})

test('PATH resolves codex when no override is set', () => {
  const result = resolveCodexExecutable({
    env: { PATH: '/usr/local/bin:/usr/bin' },
    isExecutable: (path) => path === '/usr/local/bin/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/usr/local/bin/codex')
  assert.equal(result.source, 'path')
})

test('invalid override fails closed and never falls back to PATH', () => {
  assert.throws(
    () => resolveCodexExecutable({
      env: { DSH_CODEX_EXECUTABLE: '/missing/codex', PATH: '/usr/local/bin' },
      isExecutable: (path) => path === '/usr/local/bin/codex',
      platform: 'linux',
    }),
    /configured Codex executable is not executable/,
  )
})

test('missing Codex yields a stable actionable diagnostic', () => {
  assert.throws(
    () => resolveCodexExecutable({
      env: { PATH: '/usr/bin' },
      isExecutable: () => false,
      platform: 'linux',
    }),
    /Codex CLI is unavailable/,
  )
})

test('Windows PATH lookup uses codex.exe', () => {
  const seen: string[] = []
  const result = resolveCodexExecutable({
    env: { PATH: 'C:\\Tools;C:\\Windows\\System32' },
    isExecutable: (path) => {
      seen.push(path)
      return path === 'C:\\Tools\\codex.exe'
    },
    platform: 'win32',
  })

  assert.equal(result.executable, 'C:\\Tools\\codex.exe')
  assert.equal(result.source, 'path')
  assert.equal(seen[0], 'C:\\Tools\\codex.exe')
})
