import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
let ownIdentityPromise: Promise<string | undefined> | undefined

/**
 * Numeric PIDs are recyclable, so they are not sufficient ownership tokens for
 * crash recovery. Return an OS process-birth identity when the platform exposes
 * one without inspecting process memory or credentials.
 */
export async function readProcessIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined

  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      // /proc/<pid>/stat field 2 is parenthesized comm and may contain spaces
      // or ')' characters. Everything after its final ')' starts at field 3.
      const close = stat.lastIndexOf(')')
      if (close === -1) return undefined
      const fields = stat.slice(close + 1).trim().split(/\s+/)
      const startTime = fields[19] // field 22 overall; field 3 is index 0 here.
      return startTime ? `linux:${startTime}` : undefined
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return undefined
      return undefined
    }
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'ps',
        ['-o', 'lstart=', '-p', String(pid)],
        { encoding: 'utf8', maxBuffer: 4096 },
      )
      const start = stdout.trim().replace(/\s+/g, ' ')
      return start.length > 0 ? `darwin:${start}` : undefined
    } catch {
      return undefined
    }
  }

  // Windows process creation time requires a different native seam. Windows
  // remains explicitly NOT TESTED for this release, so callers conservatively
  // fall back to PID liveness instead of guessing that a live PID is stale.
  return undefined
}

export function pidIsAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    if (error?.code === 'ESRCH') return false
    return true
  }
}

export function currentProcessIdentity(): Promise<string | undefined> {
  ownIdentityPromise ??= readProcessIdentity(process.pid)
  return ownIdentityPromise
}

/**
 * Decide whether the process that originally owned persisted state is still
 * alive. When a persisted identity is available, a recycled numeric PID does
 * not count as the same owner. On a platform without an identity seam, fail
 * closed and treat a live PID as live.
 */
export async function processOwnerIsAlive(
  pid: number,
  expectedIdentity?: string,
): Promise<boolean> {
  if (!pidIsAlive(pid)) return false
  if (expectedIdentity === undefined) return true
  const actualIdentity = await readProcessIdentity(pid)
  if (actualIdentity === undefined) return true
  return actualIdentity === expectedIdentity
}
