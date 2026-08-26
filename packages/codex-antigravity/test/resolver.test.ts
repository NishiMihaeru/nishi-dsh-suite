import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'
import {
  PLATFORM_PACKAGE_BY_TARGET,
  TARGET_TRIPLE_BY_PLATFORM,
  prependPath,
  resolveManagedCodexRuntime,
  type ResolvedCodexRuntime,
} from '../src/resolver.ts'
import {
  createEffectiveCodexConfig,
  installCodexPrimaryHistoryBridge,
} from '../src/primary-history.ts'

test('1. TARGET TRIPLE MAPPING: maps all supported OS and architecture combinations', () => {
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['win32-x64'], 'x86_64-pc-windows-msvc')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['win32-arm64'], 'aarch64-pc-windows-msvc')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['darwin-x64'], 'x86_64-apple-darwin')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['darwin-arm64'], 'aarch64-apple-darwin')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['linux-x64'], 'x86_64-unknown-linux-musl')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['linux-arm64'], 'aarch64-unknown-linux-musl')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['android-x64'], 'x86_64-unknown-linux-musl')
  assert.equal(TARGET_TRIPLE_BY_PLATFORM['android-arm64'], 'aarch64-unknown-linux-musl')

  assert.equal(PLATFORM_PACKAGE_BY_TARGET['x86_64-pc-windows-msvc'], '@openai/codex-win32-x64')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['aarch64-pc-windows-msvc'], '@openai/codex-win32-arm64')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['x86_64-apple-darwin'], '@openai/codex-darwin-x64')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['aarch64-apple-darwin'], '@openai/codex-darwin-arm64')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['x86_64-unknown-linux-musl'], '@openai/codex-linux-x64')
  assert.equal(PLATFORM_PACKAGE_BY_TARGET['aarch64-unknown-linux-musl'], '@openai/codex-linux-arm64')
})

test('2. RESOLVER REJECTS UNSUPPORTED PLATFORM: throws clear error on unsupported platform/arch', () => {
  assert.throws(() => resolveManagedCodexRuntime('freebsd' as any, 'x64'), /unsupported platform/i)
  assert.throws(() => resolveManagedCodexRuntime('win32', 'ia32' as any), /unsupported platform/i)
})

test('3. RESOLVER HARDENING: rejects missing or malformed manifest fail-closed', () => {
  const fakeRequireWithBadManifest = {
    resolve: () => fileURLToPath(import.meta.url),
  } as unknown as NodeRequire

  assert.throws(
    () => resolveManagedCodexRuntime('win32', 'x64', fakeRequireWithBadManifest),
    /failed to parse @openai\/codex package manifest/i,
  )
})

test('4. HOST RUNTIME RESOLUTION: resolves valid package-local executables on current host', () => {
  const runtime = resolveManagedCodexRuntime()
  assert.ok(runtime.executable, 'executable path must be non-empty')
  assert.ok(runtime.codeModeHost, 'codeModeHost path must be non-empty')
  assert.ok(runtime.binDir, 'binDir must be non-empty')
  assert.ok(runtime.vendorDir, 'vendorDir must be non-empty')
  assert.equal(runtime.version, '0.147.0')

  assert.ok(existsSync(runtime.executable), `Executable must exist at ${runtime.executable}`)
  assert.ok(statSync(runtime.executable).isFile(), 'Executable must be a regular file')
  assert.ok(existsSync(runtime.codeModeHost), `Code-mode host must exist at ${runtime.codeModeHost}`)
  assert.ok(statSync(runtime.codeModeHost).isFile(), 'Code-mode host must be a regular file')

  if (process.platform === 'win32') {
    assert.match(runtime.executable, /codex\.exe$/i)
    assert.match(runtime.codeModeHost, /codex-code-mode-host\.exe$/i)
  } else {
    assert.match(runtime.executable, /codex$/)
    assert.match(runtime.codeModeHost, /codex-code-mode-host$/)
  }
})

test('5. SIBLING PROXIMITY: code-mode host resides in the exact same bin directory as codex executable', () => {
  const runtime = resolveManagedCodexRuntime()
  assert.equal(join(runtime.binDir, process.platform === 'win32' ? 'codex.exe' : 'codex'), runtime.executable)
  assert.equal(join(runtime.binDir, process.platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host'), runtime.codeModeHost)
})

test('6. PATH PREPEND HELPER: prepends directory cleanly without duplication', () => {
  const sep = process.platform === 'win32' ? ';' : ':'
  const dir = 'C:\\test\\bin'
  assert.equal(prependPath(dir, undefined), dir)
  assert.equal(prependPath(dir, ''), dir)
  assert.equal(prependPath(dir, `C:\\other${sep}C:\\another`), `${dir}${sep}C:\\other${sep}C:\\another`)
  assert.equal(prependPath(dir, `${dir}${sep}C:\\other`), `${dir}${sep}C:\\other`)
})

test('7. EFFECTIVE CONFIG HELPER: computes isolated configuration without mutating input', () => {
  const runtime = resolveManagedCodexRuntime()

  const configA = { executable: 'codex', env: { TEST_KEY: 'val' } }
  const effectiveA = createEffectiveCodexConfig(configA)
  assert.notEqual(effectiveA, configA, 'must return a new object when replacing default executable')
  assert.equal(effectiveA.executable, runtime.executable)
  assert.ok(effectiveA.env?.PATH?.includes(runtime.binDir))
  assert.equal(effectiveA.env?.TEST_KEY, 'val')
  assert.equal(configA.executable, 'codex', 'input config must remain untouched')

  const configB = { executable: '', env: {} }
  const effectiveB = createEffectiveCodexConfig(configB)
  assert.equal(effectiveB.executable, runtime.executable)

  const configC = { executable: 'D:\\custom\\custom-codex.exe', env: { FOO: 'bar' } }
  const effectiveC = createEffectiveCodexConfig(configC)
  assert.equal(effectiveC, configC, 'must return the same object reference when executable is explicit')
  assert.equal(effectiveC.executable, 'D:\\custom\\custom-codex.exe')
})

test('8. PRODUCTION BRIDGE: installCodexPrimaryHistoryBridge patches openConnection and preserves contracts', async () => {
  const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..')
  const profilePackageJson = join(repoRoot, '.dsh', 'runtime', 'home', 'profiles', 'web', 'package.json')
  const profileRequire = createRequire(profilePackageJson)
  const codexPluginEntry = profileRequire.resolve('codex-plugin-dsh')
  const codexPlugin = await import(pathToFileURL(codexPluginEntry).href)

  const expectedRuntime = resolveManagedCodexRuntime(process.platform, process.arch, profileRequire)

  let cleanupFn: (() => void) | undefined
  const fakeCtx = {
    effect: (fn: () => () => void) => { cleanupFn = fn() },
  } as any

  const installed = await installCodexPrimaryHistoryBridge(fakeCtx)
  assert.equal(installed, true)

  const patchedOpenConnection = codexPlugin.CodexAppServerAdapter.prototype.openConnection
  assert.equal(typeof patchedOpenConnection, 'function')
  assert.equal(patchedOpenConnection.name, 'patchedCodexOpenConnection')

  let spawnedExecutable: string | undefined
  let spawnedEnv: Record<string, string> | undefined

  const mockCtx = {
    subprocess: {
      resolveExecutable: async (exe: string) => exe,
      spawn: (spec: any) => {
        spawnedExecutable = spec.argv[0]
        spawnedEnv = spec.env
        return {
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          done: new Promise(() => {}),
          kill() {},
          terminate() {},
        }
      },
    },
  }

  const adapterDefault = new codexPlugin.CodexAppServerAdapter(mockCtx, {
    executable: 'codex',
    env: { SESSION_ID: 'session-1' },
    disposeGraceMs: 3000,
    stderrMaxBytes: 64000,
  })

  await adapterDefault.openConnection('D:\\dummy', new AbortController().signal, async () => ({}))
  assert.equal(spawnedExecutable, expectedRuntime.executable)
  assert.ok(spawnedEnv?.PATH?.includes(expectedRuntime.binDir))
  assert.equal(spawnedEnv?.SESSION_ID, 'session-1')
  assert.equal(adapterDefault.config.executable, 'codex', 'adapter instance config must NEVER be mutated')

  const adapterEmpty = new codexPlugin.CodexAppServerAdapter(mockCtx, {
    executable: '',
    env: { SESSION_ID: 'session-empty' },
    disposeGraceMs: 3000,
    stderrMaxBytes: 64000,
  })
  await adapterEmpty.openConnection('D:\\dummy', new AbortController().signal, async () => ({}))
  assert.equal(spawnedExecutable, expectedRuntime.executable)

  const adapterCustom = new codexPlugin.CodexAppServerAdapter(mockCtx, {
    executable: 'D:\\custom\\custom-codex.exe',
    env: {},
    disposeGraceMs: 3000,
    stderrMaxBytes: 64000,
  })

  await adapterCustom.openConnection('D:\\dummy', new AbortController().signal, async () => ({}))
  assert.equal(spawnedExecutable, 'D:\\custom\\custom-codex.exe')

  assert.ok(cleanupFn !== undefined)
  cleanupFn!()
  assert.notEqual(codexPlugin.CodexAppServerAdapter.prototype.openConnection.name, 'patchedCodexOpenConnection')
})

test('9. CONCURRENCY & ZERO SHARED CONFIG MUTATION: concurrent openConnection calls remain isolated across await', async () => {
  const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..')
  const profilePackageJson = join(repoRoot, '.dsh', 'runtime', 'home', 'profiles', 'web', 'package.json')
  const profileRequire = createRequire(profilePackageJson)
  const codexPluginEntry = profileRequire.resolve('codex-plugin-dsh')
  const codexPlugin = await import(pathToFileURL(codexPluginEntry).href)

  const expectedRuntime = resolveManagedCodexRuntime(process.platform, process.arch, profileRequire)

  let cleanupFn: (() => void) | undefined
  const fakeCtx = { effect: (fn: () => () => void) => { cleanupFn = fn() } } as any
  await installCodexPrimaryHistoryBridge(fakeCtx)

  try {
    const spawnedCalls: Array<{ argv0: string; env: Record<string, string> }> = []
    const mockCtx = {
      subprocess: {
        resolveExecutable: async (exe: string) => {
          const delay = exe.includes('1') ? 50 : 20
          await new Promise((resolve) => setTimeout(resolve, delay))
          return exe
        },
        spawn: (spec: any) => {
          spawnedCalls.push({ argv0: spec.argv[0], env: spec.env })
          return {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            done: new Promise(() => {}),
            kill() {},
            terminate() {},
          }
        },
      },
    }

    const sharedOriginalConfig = Object.freeze({
      executable: 'codex',
      env: Object.freeze({ SHARED: 'true' }) as unknown as Record<string, string>,
      disposeGraceMs: 3000,
      stderrMaxBytes: 64000,
    })

    const adapter = new codexPlugin.CodexAppServerAdapter(mockCtx, sharedOriginalConfig)
    const [conn1, conn2] = await Promise.all([
      adapter.openConnection('D:\\workspace1', new AbortController().signal, async () => ({})),
      adapter.openConnection('D:\\workspace2', new AbortController().signal, async () => ({})),
    ])

    assert.ok(conn1 !== undefined)
    assert.ok(conn2 !== undefined)
    assert.equal(spawnedCalls.length, 2)
    for (const call of spawnedCalls) {
      assert.equal(call.argv0, expectedRuntime.executable)
      assert.ok(call.env.PATH.includes(expectedRuntime.binDir))
      assert.equal(call.env.SHARED, 'true')
    }
    assert.equal(adapter.config.executable, 'codex')
    assert.equal(adapter.config, sharedOriginalConfig)
  } finally {
    if (cleanupFn) cleanupFn()
  }
})
