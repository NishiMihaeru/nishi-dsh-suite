import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLATFORM_PACKAGE_BY_TARGET,
  TARGET_TRIPLE_BY_PLATFORM,
  prependPath,
  resolveManagedCodexRuntime,
} from '../src/resolver.ts'

test('Codex managed runtime keeps supported platform mappings', () => {
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['win32-x64'], 'x86_64-pc-windows-msvc')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['linux-x64'], 'x86_64-unknown-linux-musl')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['x86_64-pc-windows-msvc'], '@openai/codex-win32-x64')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['x86_64-unknown-linux-musl'], '@openai/codex-linux-x64')
})

test('Codex managed runtime fails closed for unsupported targets', () => {
  assert.throws(() => resolveManagedCodexRuntime('freebsd' as any, 'x64'), /unsupported platform/i)
  assert.throws(() => resolveManagedCodexRuntime('win32', 'ia32' as any), /unsupported platform/i)
})

test('PATH helper prepends without duplicating the managed bin directory', () => {
  const sep = process.platform === 'win32' ? ';' : ':'
  const dir = '/managed/bin'
  assert.equal(prependPath(dir, undefined), dir)
  assert.equal(prependPath(dir, `${dir}${sep}/other`), `${dir}${sep}/other`)
})

test('current host resolves the package-local Codex 0.147.0 runtime', () => {
  const runtime = resolveManagedCodexRuntime()
  assert.equal(runtime.version, '0.147.0')
  assert.ok(runtime.executable.length > 0)
  assert.ok(runtime.codeModeHost.length > 0)
})
