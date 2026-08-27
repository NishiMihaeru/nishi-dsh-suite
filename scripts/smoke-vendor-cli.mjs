#!/usr/bin/env node
/**
 * scripts/smoke-vendor-cli.mjs
 *
 * Optional, MANUAL "live" smoke test against the real, installed vendor
 * CLIs (`claude`, `codex`, `agy`). Nothing in `pnpm test` spawns a real
 * vendor CLI — every integration rides a private wire protocol with no
 * stability guarantee, so a vendor patch release can silently break the
 * product. This script is the only check that actually talks to the
 * installed binaries and proves the response shape our production code
 * assumes still holds. See docs/ROADMAP.md item R1.
 *
 * This is NOT part of `pnpm test` and is not wired into package.json by
 * this script itself. Run it by hand, deliberately, before a release:
 *
 *   node scripts/smoke-vendor-cli.mjs
 *
 * Prerequisite: the workspace packages this script imports must already be
 * built (their `lib/` output is gitignored build output, not committed):
 *
 *   pnpm build
 *
 * Behavior:
 *   - A vendor CLI that is not installed is a SKIP, not a failure.
 *   - A CLI that IS installed but errors, times out, or returns a payload
 *     that fails production normalization is a FAIL.
 *   - Exit code is non-zero iff at least one provider FAILed. SKIPs alone
 *     exit 0.
 *   - Every check has a hard timeout and every spawned child process is
 *     guaranteed to be killed, including on script crash.
 *   - Output reports SHAPE only (status enums, field presence, counts).
 *     It never prints real usage percentages, token/credit balances,
 *     reset timestamps, account identifiers, or filesystem paths that
 *     contain a username.
 *
 * What each provider check actually exercises:
 *   - claude:      spawns `claude --print --verbose --input-format stream-json
 *                  --output-format stream-json --no-session-persistence
 *                  --tools '' --strict-mcp-config` (the exact argv from
 *                  claude-usage-source's claudeUsageCliArgv), issues one
 *                  `control_request` of subtype `get_usage` after the CLI's
 *                  `system`/`init` message, and feeds the raw response
 *                  through the production `normalizeClaudeUsage()`
 *                  normalizer from @nishi/usage-limits. No model turn is
 *                  ever sent.
 *   - codex:       spawns `codex app-server --stdio` (codexAppServerArgv),
 *                  performs the JSON-RPC `initialize` -> `initialized` ->
 *                  `account/rateLimits/read` sequence, and feeds the result
 *                  through the production `normalizeCodexRateLimits()`
 *                  normalizer. No thread/session is created.
 *   - antigravity: constructs the real `AntigravityCliAdapter` from
 *                  packages/antigravity against a minimal stand-in cordis
 *                  context (only `ctx.subprocess.resolveExecutable` /
 *                  `ctx.subprocess.spawn` are used by this adapter) and
 *                  calls its real `listModels()`, which runs
 *                  `agy --output-format json models` (falling back to
 *                  `agy models`) exactly as production does. No turn/
 *                  generation is ever run.
 */

import { spawn as spawnChildProcess } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter as PATH_DELIMITER, dirname, isAbsolute, join as joinPath, resolve as resolvePath } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolvePath(__dirname, '..')

const VERSION_CHECK_TIMEOUT_MS = 10_000
const USAGE_REQUEST_TIMEOUT_MS = 20_000
const HARD_DEADLINE_MS = 35_000
const DISPOSE_GRACE_MS = 3_000

// ---------------------------------------------------------------------------
// Process bookkeeping: every raw child process we spawn (directly or via the
// minimal SubprocessHandle adapter below) is tracked here so it can be force
// -killed on a hard timeout, a thrown error, or script exit -- no orphans.
// ---------------------------------------------------------------------------

/** @type {Set<import('node:child_process').ChildProcess>} */
const trackedProcesses = new Set()

function killTracked(signal = 'SIGKILL') {
  for (const child of trackedProcesses) {
    try {
      child.kill(signal)
    } catch {
      // process already gone; nothing to do
    }
  }
}

process.on('exit', () => killTracked('SIGKILL'))
process.on('SIGINT', () => {
  killTracked('SIGKILL')
  process.exit(130)
})
process.on('SIGTERM', () => {
  killTracked('SIGKILL')
  process.exit(143)
})

// ---------------------------------------------------------------------------
// Executable resolution -- mirrors the bare-name-on-PATH resolution used by
// packages/claude-usage-source/src/executable.ts and
// packages/codex-usage-source/src/executable.ts, generalized for all three
// vendor CLIs. Only used to DETECT installs and to feed a resolved absolute
// path to the real production spawn code.
// ---------------------------------------------------------------------------

function isExecutableFile(candidate) {
  try {
    accessSync(candidate, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveOnPath(name, env = process.env) {
  if (isAbsolute(name)) return isExecutableFile(name) ? name : undefined
  const exeName = process.platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  for (const dir of pathValue.split(PATH_DELIMITER)) {
    if (dir.length === 0) continue
    const candidate = joinPath(dir, exeName)
    if (isExecutableFile(candidate)) return candidate
  }
  return undefined
}

/** Redact the user's home directory out of anything we're about to print. */
function redactHome(text) {
  const home = homedir()
  if (!home) return text
  return text.split(home).join('~')
}

// ---------------------------------------------------------------------------
// Minimal SubprocessHandle adapter satisfying the `spawn: (spec) =>
// SubprocessHandle` seam consumed by OfficialClaudeUsageSource,
// OfficialCodexRateLimitsSource, and (via a stand-in ctx) AntigravityCliAdapter.
// This is a deliberately small, self-contained reimplementation of just the
// surface those three call (argv, cwd, stdio, graceMs, signal, env, stdin,
// stdout, stderr, done, terminate, waitForExit) -- it is NOT the hardened
// production @deepseek-ai/dsh-subprocess-local implementation, and it
// intentionally skips that implementation's parent-env credential scrubbing:
// this script only ever runs read-only, no-op vendor CLI commands locally,
// never forwards untrusted input, and the whole point here is exercising the
// vendor wire protocol, not re-proving the hardened runtime's own security
// properties (which have their own coverage in each package's test suite).
// ---------------------------------------------------------------------------

/**
 * Bounded in-memory tail buffer backing the `SubprocessCollect` stdio mode
 * (`{ maxBytes }`, no spill). Callers here only ever read once, after the
 * child has exited, so a simple "keep the tail, mark it lossy if we dropped
 * the head" buffer is sufficient -- it does not need to support the general
 * incremental offset-read contract precisely.
 */
function createCollector(maxBytes) {
  let buffer = Buffer.alloc(0)
  let truncated = false
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > maxBytes) {
        buffer = buffer.subarray(buffer.length - maxBytes)
        truncated = true
      }
    },
    reader: {
      readFrom() {
        return { text: buffer.toString('utf8'), nextOffset: buffer.length, lossy: truncated, spillPath: undefined }
      },
    },
  }
}

/** stdio mode -> the underlying node:child_process stdio disposition. */
function nodeStdioFor(mode) {
  return mode === 'inherit' ? 'inherit' : 'pipe'
}

function createSpawn() {
  return function spawn(spec) {
    const stdio = [
      spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore',
      nodeStdioFor(spec.stdio.stdout),
      nodeStdioFor(spec.stdio.stderr),
    ]
    const child = spawnChildProcess(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio,
    })
    trackedProcesses.add(child)

    // `'pipe'` hands the raw Readable straight to the caller (the Claude/Codex
    // control-protocol sources decode stdout themselves). A `SubprocessCollect`
    // object (`{ maxBytes }`, used by the Antigravity adapter) instead means
    // WE consume the stream here and expose an offset-reader through
    // `collected` -- the raw stream is not exposed in that mode.
    const collected = {}
    let exposedStdout
    let exposedStderr
    if (spec.stdio.stdout === 'pipe') {
      exposedStdout = child.stdout ?? undefined
    } else if (spec.stdio.stdout && typeof spec.stdio.stdout === 'object') {
      const collector = createCollector(spec.stdio.stdout.maxBytes)
      child.stdout?.on('data', (chunk) => collector.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
      collected.stdout = collector.reader
    }
    if (spec.stdio.stderr === 'pipe') {
      exposedStderr = child.stderr ?? undefined
    } else if (spec.stdio.stderr && typeof spec.stdio.stderr === 'object') {
      const collector = createCollector(spec.stdio.stderr.maxBytes)
      child.stderr?.on('data', (chunk) => collector.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
      collected.stderr = collector.reader
    }

    let terminated = false
    let killTimer
    function terminate() {
      if (terminated) return
      terminated = true
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }, spec.graceMs ?? DISPOSE_GRACE_MS)
      killTimer.unref?.()
    }

    if (spec.signal) {
      if (spec.signal.aborted) terminate()
      else spec.signal.addEventListener('abort', terminate, { once: true })
    }

    const done = new Promise((resolveDone, rejectDone) => {
      child.once('error', (error) => rejectDone(error))
      child.once('close', (exitCode, signal) => {
        if (killTimer !== undefined) clearTimeout(killTimer)
        trackedProcesses.delete(child)
        resolveDone({ exitCode, signal })
      })
    })
    done.catch(() => {})

    return {
      pid: child.pid ?? -1,
      stdin: child.stdin ?? undefined,
      stdout: exposedStdout,
      stderr: exposedStderr,
      collected,
      done,
      terminate,
      async waitForExit() {
        try {
          await done
        } catch {
          // done already carries the failure; waitForExit only reports liveness
        }
        return true
      },
    }
  }
}

/** ctx.subprocess.resolveExecutable(command, env, signal) stand-in. */
async function resolveExecutableForAdapter(command, env) {
  const resolved = resolveOnPath(command, { ...process.env, ...env })
  if (!resolved) throw new Error(`smoke-vendor-cli: executable not found on PATH: ${command}`)
  return resolved
}

// ---------------------------------------------------------------------------
// Small process helpers
// ---------------------------------------------------------------------------

function runCaptured(executable, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawnChildProcess(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    trackedProcesses.add(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
      resolveRun({ timedOut: true, exitCode: null, stdout, stderr })
    }, timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 8192) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 8192) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      trackedProcesses.delete(child)
      resolveRun({ timedOut: false, exitCode: null, stdout, stderr, spawnError: error })
    })
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      trackedProcesses.delete(child)
      resolveRun({ timedOut: false, exitCode, stdout, stderr })
    })
  })
}

async function withHardDeadline(promise, ms) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      killTracked('SIGKILL')
      reject(new Error(`hard deadline of ${ms}ms exceeded; all tracked child processes were killed`))
    }, ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Built workspace package loading
// ---------------------------------------------------------------------------

async function loadBuiltModule(relativeLibPath, label) {
  const absolutePath = resolvePath(REPO_ROOT, relativeLibPath)
  if (!existsSync(absolutePath)) {
    throw new Error(
      `${label}: built output not found at ${redactHome(absolutePath)}. Run "pnpm build" first, then re-run this smoke script.`,
    )
  }
  return import(pathToFileURL(absolutePath).href)
}

// ---------------------------------------------------------------------------
// Result reporting
// ---------------------------------------------------------------------------

/** @typedef {{ provider: string, outcome: 'PASS' | 'SKIP' | 'FAIL', detail: string }} CheckResult */

/** @type {CheckResult[]} */
const results = []

function record(provider, outcome, detail) {
  results.push({ provider, outcome, detail })
  const marker = outcome === 'PASS' ? 'PASS' : outcome === 'SKIP' ? 'SKIP' : 'FAIL'
  console.log(`[${marker}] ${provider}: ${redactHome(detail)}`)
}

// ---------------------------------------------------------------------------
// Claude check
// ---------------------------------------------------------------------------

async function checkClaude() {
  const provider = 'claude'
  const executable = resolveOnPath('claude')
  if (!executable) {
    record(provider, 'SKIP', 'claude CLI not found on PATH')
    return
  }

  const version = await runCaptured(executable, ['--version'], VERSION_CHECK_TIMEOUT_MS)
  const versionText = version.timedOut
    ? '(version check timed out)'
    : (version.stdout || version.stderr).trim().split('\n')[0].slice(0, 200) || '(empty)'
  console.log(`  claude version: ${redactHome(versionText)}`)

  const { OfficialClaudeUsageSource } = await loadBuiltModule(
    'packages/claude-usage-source/lib/index.js',
    provider,
  )
  const { normalizeClaudeUsage } = await loadBuiltModule('packages/usage-limits/lib/index.js', provider)

  try {
    const source = new OfficialClaudeUsageSource({
      cwd: REPO_ROOT,
      executable,
      spawn: createSpawn(),
      requestTimeoutMs: USAGE_REQUEST_TIMEOUT_MS,
      disposeGraceMs: DISPOSE_GRACE_MS,
    })
    const payload = await withHardDeadline(source.getUsage(), HARD_DEADLINE_MS)
    const snapshot = normalizeClaudeUsage(payload, Date.now())
    record(
      provider,
      'PASS',
      `usage snapshot normalized OK (status=${snapshot.status}, windows=${snapshot.windows.length}, ` +
        `hasExtraUsage=${snapshot.extraUsage !== undefined})`,
    )
  } catch (error) {
    record(provider, 'FAIL', `${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Codex check
// ---------------------------------------------------------------------------

async function checkCodex() {
  const provider = 'codex'
  const executable = resolveOnPath('codex')
  if (!executable) {
    record(provider, 'SKIP', 'codex CLI not found on PATH')
    return
  }

  const version = await runCaptured(executable, ['--version'], VERSION_CHECK_TIMEOUT_MS)
  const versionText = version.timedOut
    ? '(version check timed out)'
    : (version.stdout || version.stderr).trim().split('\n')[0].slice(0, 200) || '(empty)'
  console.log(`  codex version: ${redactHome(versionText)}`)

  const { OfficialCodexRateLimitsSource } = await loadBuiltModule(
    'packages/codex-usage-source/lib/index.js',
    provider,
  )
  const { normalizeCodexRateLimits } = await loadBuiltModule('packages/usage-limits/lib/index.js', provider)

  try {
    const source = new OfficialCodexRateLimitsSource({
      cwd: REPO_ROOT,
      executable,
      spawn: createSpawn(),
      requestTimeoutMs: USAGE_REQUEST_TIMEOUT_MS,
      disposeGraceMs: DISPOSE_GRACE_MS,
    })
    const payload = await withHardDeadline(source.readRateLimits(), HARD_DEADLINE_MS)
    const snapshot = normalizeCodexRateLimits(payload, Date.now())
    record(
      provider,
      'PASS',
      `rate-limits snapshot normalized OK (status=${snapshot.status}, windows=${snapshot.windows.length}, ` +
        `hasExtraUsage=${snapshot.extraUsage !== undefined})`,
    )
  } catch (error) {
    record(provider, 'FAIL', `${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Antigravity check
// ---------------------------------------------------------------------------

async function checkAntigravity() {
  const provider = 'antigravity'
  const executable = resolveOnPath('agy')
  if (!executable) {
    record(provider, 'SKIP', 'agy CLI not found on PATH')
    return
  }

  const version = await runCaptured(executable, ['--version'], VERSION_CHECK_TIMEOUT_MS)
  const versionText = version.timedOut
    ? '(version check timed out)'
    : (version.stdout || version.stderr).trim().split('\n')[0].slice(0, 200) || '(empty)'
  console.log(`  agy version: ${redactHome(versionText)}`)

  const { AntigravityCliAdapter } = await loadBuiltModule(
    'packages/antigravity/lib/antigravity-primary.js',
    provider,
  )

  const fakeCtx = {
    subprocess: {
      resolveExecutable: resolveExecutableForAdapter,
      spawn: createSpawn(),
    },
  }
  const config = {
    executable: 'agy',
    env: {},
    modelCacheMs: 0,
    catalogTimeoutMs: USAGE_REQUEST_TIMEOUT_MS,
    turnTimeoutMs: USAGE_REQUEST_TIMEOUT_MS,
    disposeGraceMs: DISPOSE_GRACE_MS,
    stderrMaxBytes: 64 * 1024,
  }

  const adapter = new AntigravityCliAdapter(fakeCtx, config)
  try {
    const models = await withHardDeadline(adapter.listModels(provider), HARD_DEADLINE_MS)
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('listModels() returned no models')
    }
    for (const [index, model] of models.entries()) {
      if (typeof model.id !== 'string' || model.id.trim().length === 0) {
        throw new Error(`model[${index}] missing a non-empty string "id"`)
      }
      if (typeof model.name !== 'string' || model.name.trim().length === 0) {
        throw new Error(`model[${index}] missing a non-empty string "name"`)
      }
      if (!Array.isArray(model.inputModalities) || model.inputModalities.length === 0) {
        throw new Error(`model[${index}] missing non-empty "inputModalities"`)
      }
    }
    record(provider, 'PASS', `listModels() returned ${models.length} model(s) with expected shape`)
  } catch (error) {
    record(provider, 'FAIL', `${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await adapter.dispose().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('smoke-vendor-cli: opt-in live protocol check against installed vendor CLIs')
  console.log(`repo root: ${redactHome(REPO_ROOT)}`)
  console.log('')

  for (const check of [checkClaude, checkCodex, checkAntigravity]) {
    try {
      await check()
    } catch (error) {
      // A check function should catch its own errors and record() a FAIL;
      // this is a last-resort net so one crashed check cannot abort the
      // remaining ones or skip cleanup.
      record(check.name.replace(/^check/, '').toLowerCase(), 'FAIL', `unexpected error: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log('')
  }

  console.log('Summary:')
  for (const result of results) {
    console.log(`  ${result.outcome.padEnd(4)} ${result.provider}`)
  }

  const failed = results.filter((result) => result.outcome === 'FAIL')
  const skipped = results.filter((result) => result.outcome === 'SKIP')
  const passed = results.filter((result) => result.outcome === 'PASS')
  console.log('')
  console.log(`${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed`)

  process.exitCode = failed.length > 0 ? 1 : 0
}

main().catch((error) => {
  killTracked('SIGKILL')
  console.error('smoke-vendor-cli: fatal error', redactHome(error instanceof Error ? error.stack ?? error.message : String(error)))
  process.exitCode = 1
})
