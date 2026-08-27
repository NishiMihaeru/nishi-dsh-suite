import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveVendorExecutable } from '../src/executable.ts'

const CODEX_DESCRIPTOR = {
  id: 'codex',
  defaultName: 'codex',
  envOverride: 'DSH_CODEX_EXECUTABLE',
} as const

test('explicit config value wins over the environment override and PATH', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    config: '/opt/config/codex',
    env: { DSH_CODEX_EXECUTABLE: '/opt/env/codex', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/opt/config/codex' || path === '/opt/env/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/opt/config/codex')
  assert.equal(result.source, 'config')
})

test('an invalid explicit config value fails closed and never falls back to the override or PATH', () => {
  assert.throws(
    () => resolveVendorExecutable(CODEX_DESCRIPTOR, {
      config: '/missing/codex',
      env: { DSH_CODEX_EXECUTABLE: '/opt/env/codex', PATH: '/usr/bin' },
      isExecutable: (path) => path === '/opt/env/codex',
      platform: 'linux',
    }),
    /codex: configured executable is not executable/,
  )
})

test('environment override wins over PATH when no config value is set', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    env: { DSH_CODEX_EXECUTABLE: '/opt/codex/bin/codex', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/opt/codex/bin/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/opt/codex/bin/codex')
  assert.equal(result.source, 'override')
})

test('an invalid environment override fails closed and never falls back to PATH', () => {
  assert.throws(
    () => resolveVendorExecutable(CODEX_DESCRIPTOR, {
      env: { DSH_CODEX_EXECUTABLE: '/missing/codex', PATH: '/usr/local/bin' },
      isExecutable: (path) => path === '/usr/local/bin/codex',
      platform: 'linux',
    }),
    /DSH_CODEX_EXECUTABLE executable is not executable/,
  )
})

test('PATH resolves the executable when no config value or override is set', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    env: { PATH: '/usr/local/bin:/usr/bin' },
    isExecutable: (path) => path === '/usr/local/bin/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/usr/local/bin/codex')
  assert.equal(result.source, 'path')
})

test('a blank config value and a blank override are both treated as absent', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    config: '   ',
    env: { DSH_CODEX_EXECUTABLE: '  ', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/usr/bin/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/usr/bin/codex')
  assert.equal(result.source, 'path')
})

test('missing executable yields a stable diagnostic naming the provider and the env override', () => {
  assert.throws(
    () => resolveVendorExecutable(CODEX_DESCRIPTOR, {
      env: { PATH: '/usr/bin' },
      isExecutable: () => false,
      platform: 'linux',
    }),
    /codex: executable is unavailable.*DSH_CODEX_EXECUTABLE/s,
  )
})

test('Windows PATH lookup uses the default `${name}.exe` suffix', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    env: { PATH: 'C:\\Tools;C:\\Windows\\System32' },
    isExecutable: (path) => path === 'C:\\Tools\\codex.exe',
    platform: 'win32',
  })

  assert.equal(result.executable, 'C:\\Tools\\codex.exe')
  assert.equal(result.source, 'path')
})

test('Windows PATH lookup honours an explicit windowsName override', () => {
  const descriptor = {
    id: 'antigravity',
    defaultName: 'agy',
    envOverride: 'DSH_ANTIGRAVITY_EXECUTABLE',
    windowsName: 'agy.cmd',
  } as const

  const result = resolveVendorExecutable(descriptor, {
    env: { PATH: 'C:\\Tools' },
    isExecutable: (path) => path === 'C:\\Tools\\agy.cmd',
    platform: 'win32',
  })

  assert.equal(result.executable, 'C:\\Tools\\agy.cmd')
})

test('a descriptor missing envOverride is rejected before any resolution attempt', () => {
  assert.throws(
    () => resolveVendorExecutable({ id: 'codex', defaultName: 'codex', envOverride: '' } as any),
    /descriptor\.envOverride must be a non-empty string/,
  )
})

test('a descriptor missing id is rejected with a diagnostic that still identifies the failing field', () => {
  assert.throws(
    () => resolveVendorExecutable({ id: '', defaultName: 'codex', envOverride: 'DSH_CODEX_EXECUTABLE' } as any),
    /descriptor\.id must be a non-empty string/,
  )
})

test('directories are separated by the platform PATH delimiter', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    env: { PATH: '/first:/second:/third' },
    isExecutable: (path) => path === '/third/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/third/codex')
})

test('empty PATH segments are skipped without throwing', () => {
  const result = resolveVendorExecutable(CODEX_DESCRIPTOR, {
    env: { PATH: '::/usr/bin::' },
    isExecutable: (path) => path === '/usr/bin/codex',
    platform: 'linux',
  })

  assert.equal(result.executable, '/usr/bin/codex')
})
