/**
 * Official Codex app-server rate-limits source adapter.
 *
 * Implements a short-lived official Codex app-server (0.147.0)
 * JSON-RPC read session without thread creation, model prompts, or credential copying.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export const DEFAULT_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024

const require = createRequire(import.meta.url)

function resolveCodexBin(): string {
  let pkgPath: string | undefined
  try {
    pkgPath = require.resolve('@openai/codex/package.json')
  } catch {}

  if (pkgPath === undefined) {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      resolve(here, '..', 'node_modules', '@openai', 'codex', 'package.json'),
      resolve(here, '..', '..', 'codex', 'node_modules', '@openai', 'codex', 'package.json'),
      resolve(here, '..', '..', '..', 'node_modules', '.pnpm', '@openai+codex@0.147.0', 'node_modules', '@openai', 'codex', 'package.json'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        pkgPath = candidate
        break
      }
    }
  }

  if (pkgPath !== undefined && existsSync(pkgPath)) {
    try {
      const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: { codex: string } }
      return resolve(dirname(pkgPath), manifest.bin.codex)
    } catch {}
  }
  return 'codex'
}

export const CODEX_PACKAGE_BIN = resolveCodexBin()

export interface OfficialCodexRateLimitsSourceSpec {
  readonly cwd: string
  readonly executable?: string
  readonly env?: Readonly<Record<string, string>>
  readonly requestTimeoutMs?: number
  readonly disposeGraceMs?: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly onRateLimitsUpdated?: () => void
}

export interface CodexRateLimitsSourceLike {
  readRateLimits(): Promise<unknown>
}

export function codexAppServerArgv(
  _platform: NodeJS.Platform = process.platform,
  executable?: string,
): string[] {
  if (executable !== undefined) return [executable, 'app-server', '--stdio']
  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function assertPositiveFinite(owner: string, name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${owner}: ${name} must be a positive safe integer`)
  }
}

async function disposeCodexChild(child: SubprocessHandle): Promise<void> {
  if (child.pid <= 0) {
    await child.done.catch(() => {})
    return
  }
  try { child.stdin?.end() } catch {}
  child.terminate()
  await child.waitForExit()
  await child.done
}

export class OfficialCodexRateLimitsSource implements CodexRateLimitsSourceLike {
  private readonly spec: OfficialCodexRateLimitsSourceSpec

  constructor(spec: OfficialCodexRateLimitsSourceSpec) {
    if (!spec || typeof spec !== 'object') throw new Error('codex-usage-source: spec must be a non-null object')
    if (typeof spec.cwd !== 'string' || spec.cwd.trim().length === 0) throw new Error('codex-usage-source: cwd must be a non-empty string')
    if (typeof spec.spawn !== 'function') throw new Error('codex-usage-source: spawn must be a function')
    if (spec.requestTimeoutMs !== undefined) {
      assertPositiveFinite('codex-usage-source', 'requestTimeoutMs', spec.requestTimeoutMs)
      if (spec.requestTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`codex-usage-source: requestTimeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    if (spec.disposeGraceMs !== undefined) {
      assertPositiveFinite('codex-usage-source', 'disposeGraceMs', spec.disposeGraceMs)
      if (spec.disposeGraceMs > MAX_TIMER_DELAY_MS) throw new Error(`codex-usage-source: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    this.spec = spec
  }

  async readRateLimits(): Promise<unknown> {
    const timeoutMs = this.spec.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const graceMs = this.spec.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
    const argv = codexAppServerArgv(process.platform, this.spec.executable)
    const env = { ...scrubbedParentEnv(), ...this.spec.env }

    let child: SubprocessHandle | undefined
    try {
      child = this.spec.spawn({
        argv,
        cwd: this.spec.cwd,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
        graceMs,
        env,
      })
    } catch (spawnError) {
      throw thrown(spawnError)
    }
    if (!child || typeof child !== 'object') throw new Error('codex-usage-source: spawn did not return a valid SubprocessHandle')

    const initRequestId = 'req_init'
    const readRequestId = 'req_read'
    let opError: Error | undefined
    let rawResult: unknown
    const stdout = child.stdout
    const stdin = child.stdin
    let cleanupListeners = () => {}
    let timer: NodeJS.Timeout | undefined

    try {
      if (!stdout || !stdin) throw new Error('codex-usage-source: child process did not provide pipe stdio streams')

      rawResult = await new Promise<unknown>((resolvePromise, reject) => {
        let settled = false
        const fail = (err: Error) => {
          if (settled) return
          settled = true
          reject(err)
        }
        const win = (val: unknown) => {
          if (settled) return
          settled = true
          resolvePromise(val)
        }

        timer = setTimeout(() => fail(new Error('codex-usage-source: app-server request timed out')), timeoutMs)
        timer.unref?.()
        child!.done.then(
          (procOutcome) => fail(new Error(`codex-usage-source: app-server exited before read settled (code ${procOutcome.exitCode}, signal ${procOutcome.signal})`)),
          (procErr) => fail(thrown(procErr)),
        )

        let initCompleted = false
        let byteBuffer = Buffer.alloc(0)
        const writeJsonRpc = (msg: unknown) => {
          try { stdin.write(`${JSON.stringify(msg)}\n`) } catch (writeErr) { fail(thrown(writeErr)) }
        }
        const handleLine = (line: string) => {
          if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
            fail(new Error(`codex-usage-source: Protocol line length exceeds maximum byte limit of ${MAX_PROTOCOL_LINE_BYTES} bytes`))
            return
          }
          let parsed: unknown
          try { parsed = JSON.parse(line) } catch {
            fail(new Error('codex-usage-source: Malformed JSON protocol line received'))
            return
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            fail(new Error('codex-usage-source: Invalid protocol message received'))
            return
          }
          const frame = parsed as Record<string, unknown>
          if (typeof frame.method === 'string' && frame.id === undefined) {
            if (frame.method === 'account/rateLimits/updated') {
              try { this.spec.onRateLimitsUpdated?.() } catch {}
            }
            return
          }
          if (frame.id === initRequestId) {
            if (frame.error) {
              const detail = typeof frame.error === 'object' && frame.error && 'message' in frame.error
                ? String((frame.error as Record<string, unknown>).message)
                : JSON.stringify(frame.error)
              fail(new Error(`codex-usage-source: initialize failed: ${detail}`))
              return
            }
            if (frame.result === undefined || frame.result === null || typeof frame.result !== 'object') {
              fail(new Error('codex-usage-source: initialize response result is invalid'))
              return
            }
            initCompleted = true
            writeJsonRpc({ jsonrpc: '2.0', method: 'initialized' })
            writeJsonRpc({ jsonrpc: '2.0', id: readRequestId, method: 'account/rateLimits/read' })
            return
          }
          if (frame.id === readRequestId) {
            if (!initCompleted) {
              fail(new Error('codex-usage-source: read response received before initialize completed'))
              return
            }
            if (frame.error) {
              const detail = typeof frame.error === 'object' && frame.error && 'message' in frame.error
                ? String((frame.error as Record<string, unknown>).message)
                : JSON.stringify(frame.error)
              fail(new Error(`codex-usage-source: account/rateLimits/read failed: ${detail}`))
              return
            }
            if (frame.result === undefined) {
              fail(new Error('codex-usage-source: account/rateLimits/read response missing result'))
              return
            }
            win(frame.result)
          }
        }
        const onData = (chunk: unknown) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(String(chunk), 'utf8')
          byteBuffer = Buffer.concat([byteBuffer, buf])
          if (byteBuffer.length > MAX_PROTOCOL_LINE_BYTES) {
            const newlineIndex = byteBuffer.indexOf(0x0a)
            if (newlineIndex < 0 || newlineIndex > MAX_PROTOCOL_LINE_BYTES) {
              fail(new Error(`codex-usage-source: Protocol line length exceeds maximum byte limit of ${MAX_PROTOCOL_LINE_BYTES} bytes`))
              return
            }
          }
          for (;;) {
            const newlineIndex = byteBuffer.indexOf(0x0a)
            if (newlineIndex < 0) break
            if (newlineIndex > MAX_PROTOCOL_LINE_BYTES) {
              fail(new Error(`codex-usage-source: Protocol line length exceeds maximum byte limit of ${MAX_PROTOCOL_LINE_BYTES} bytes`))
              return
            }
            const line = byteBuffer.subarray(0, newlineIndex).toString('utf8').trim()
            byteBuffer = byteBuffer.subarray(newlineIndex + 1)
            if (line.length > 0) handleLine(line)
          }
        }
        const onEnd = () => {
          if (byteBuffer.length > MAX_PROTOCOL_LINE_BYTES) {
            fail(new Error(`codex-usage-source: Protocol line length exceeds maximum byte limit of ${MAX_PROTOCOL_LINE_BYTES} bytes`))
            return
          }
          if (byteBuffer.length > 0) {
            const line = byteBuffer.toString('utf8').trim()
            if (line.length > 0) handleLine(line)
          }
          fail(new Error('codex-usage-source: app-server protocol stream closed'))
        }
        const onError = (err: unknown) => fail(thrown(err))
        stdout.on('data', onData)
        stdout.on('end', onEnd)
        stdout.on('error', onError)
        stdin.on?.('error', onError)
        cleanupListeners = () => {
          stdout.off('data', onData)
          stdout.off('end', onEnd)
          stdout.off('error', onError)
          stdin.off?.('error', onError)
        }

        writeJsonRpc({
          jsonrpc: '2.0',
          id: initRequestId,
          method: 'initialize',
          params: {
            clientInfo: { name: 'deepseek-harness', title: 'DeepSeek Harness', version: '0.0.1' },
            capabilities: { experimentalApi: false, requestAttestation: false },
          },
        })
      })
    } catch (err) {
      opError = thrown(err)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      cleanupListeners()
      try {
        await disposeCodexChild(child)
      } catch (disposeErr) {
        const cleanupError = thrown(disposeErr)
        if (opError !== undefined) {
          throw new AggregateError([opError, cleanupError], 'codex-usage-source: read failed and app-server cleanup also failed')
        }
        throw cleanupError
      }
    }

    if (opError !== undefined) throw opError
    return rawResult
  }
}
