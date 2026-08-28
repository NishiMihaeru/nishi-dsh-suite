import { randomBytes } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { link, lstat, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200
const DEFAULT_LOCK_WAIT_MS = 2_000

interface DirectoryAnchor {
  readonly path: string
  readonly identity: Stats
  readonly descriptorAnchored: boolean
}

export interface ExclusiveAtomicWriteOptions {
  readonly mode: number
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertRealDirectory(stats: Stats, dirPath: string): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Canonical path component at "${dirPath}" must be a real directory, not a symbolic link or non-directory entry`,
    )
  }
}

async function canonicalDirectoryStats(dirPath: string): Promise<Stats | undefined> {
  try {
    const stats = await lstat(dirPath)
    assertRealDirectory(stats, dirPath)
    return stats
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined
    throw err
  }
}

async function assertDirectoryPathIdentity(dirPath: string, expected: Stats): Promise<void> {
  const current = await lstat(dirPath)
  assertRealDirectory(current, dirPath)
  if (!sameIdentity(current, expected)) {
    throw new Error(`Canonical directory at "${dirPath}" changed during the filesystem operation`)
  }
}

async function descriptorAnchorPath(fd: number, expected: Stats): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined
  for (const candidate of [`/proc/self/fd/${fd}`, `/dev/fd/${fd}`]) {
    try {
      const current = await stat(candidate)
      if (current.isDirectory() && sameIdentity(current, expected)) return candidate
    } catch {
      // Try the next descriptor-filesystem spelling.
    }
  }
  return undefined
}

async function withDirectoryAnchor<T>(
  dirPath: string,
  operation: (anchor: DirectoryAnchor) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal)
  const before = await canonicalDirectoryStats(dirPath)
  if (before === undefined) {
    throw new Error(`Canonical target directory at "${dirPath}" does not exist`)
  }
  throwIfAborted(signal)

  if (process.platform === 'win32') {
    const result = await operation({ path: dirPath, identity: before, descriptorAnchored: false })
    await assertDirectoryPathIdentity(dirPath, before)
    return result
  }

  const directory = await open(dirPath, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    const opened = await directory.stat()
    if (!opened.isDirectory() || !sameIdentity(before, opened)) {
      throw new Error(`Canonical directory at "${dirPath}" changed while it was being opened`)
    }
    await assertDirectoryPathIdentity(dirPath, opened)
    throwIfAborted(signal)

    const descriptorPath = await descriptorAnchorPath(directory.fd, opened)
    const anchor: DirectoryAnchor = {
      path: descriptorPath ?? dirPath,
      identity: opened,
      descriptorAnchored: descriptorPath !== undefined,
    }
    const result = await operation(anchor)
    if (!anchor.descriptorAnchored) await assertDirectoryPathIdentity(dirPath, opened)
    return result
  } finally {
    await directory.close()
  }
}

function directChildName(dirPath: string, targetFilePath: string): string {
  const resolvedDir = resolve(dirPath)
  const resolvedTarget = resolve(targetFilePath)
  if (dirname(resolvedTarget) !== resolvedDir) {
    throw new Error(`Canonical target "${targetFilePath}" must be a direct child of "${dirPath}"`)
  }
  return basename(resolvedTarget)
}

async function assertRegularTargetIfPresent(targetPath: string, logicalPath: string): Promise<Stats | undefined> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Canonical target at "${logicalPath}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
    return stats
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined
    throw err
  }
}

/**
 * Asserts that a canonical directory component, if present, is a real directory
 * and not a symbolic link, junction, or non-directory entry.
 * Returns true if directory exists and is valid, false if absent (ENOENT).
 */
export async function validateCanonicalDirectory(dirPath: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  const stats = await canonicalDirectoryStats(dirPath)
  throwIfAborted(signal)
  return stats !== undefined
}

/**
 * Ensures a canonical directory exists as a real directory. Creation is
 * anchored through the already-opened real parent directory on platforms that
 * expose descriptor paths, so replacing the parent pathname cannot redirect
 * the mkdir into a symlink/junction target.
 */
export async function ensureCanonicalDirectory(dirPath: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const exists = await canonicalDirectoryStats(dirPath)
  if (exists !== undefined) return

  const parentPath = dirname(resolve(dirPath))
  const childName = basename(resolve(dirPath))
  await withDirectoryAnchor(parentPath, async (parent) => {
    throwIfAborted(signal)
    try {
      await mkdir(resolve(parent.path, childName))
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err
    }
  }, signal)

  throwIfAborted(signal)
  const created = await canonicalDirectoryStats(dirPath)
  if (created === undefined) {
    throw new Error(`Canonical directory at "${dirPath}" was not created`)
  }
}

async function isLockContention(error: unknown, lockPath: string): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EEXIST') return true
  if (code !== 'EPERM') return false
  try {
    await lstat(lockPath)
    return true
  } catch {
    return false
  }
}

async function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  try {
    await sleep(delay, undefined, signal === undefined ? undefined : { signal })
  } catch {
    throwIfAborted(signal)
    throw new Error('Project memory writer lock wait failed')
  }
  throwIfAborted(signal)
}

/**
 * Run one complete writer operation while holding the exact same `<target>.lock`
 * namespace used by DSH atomic-write. Acquisition is cooperative with an
 * AbortSignal: cancellation while waiting stops before the lock is acquired and
 * therefore before any caller mutation can run.
 */
export async function withSafeFileWriterLock<T>(
  dirPath: string,
  targetFilePath: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal)
  if (!(await validateCanonicalDirectory(dirPath, signal))) {
    throw new Error(`Canonical target directory at "${dirPath}" does not exist`)
  }
  const targetName = directChildName(dirPath, targetFilePath)

  return withDirectoryAnchor(dirPath, async (anchor) => {
    const anchoredTarget = resolve(anchor.path, targetName)
    const lockPath = `${anchoredTarget}.lock`
    const deadline = Date.now() + DEFAULT_LOCK_WAIT_MS
    let delay = LOCK_RETRY_INITIAL_MS
    let acquired = false

    for (;;) {
      throwIfAborted(signal)
      try {
        await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
        acquired = true
        break
      } catch (error) {
        if (!await isLockContention(error, lockPath)) throw error
      }
      throwIfAborted(signal)
      if (Date.now() >= deadline) {
        throw new Error(`atomic-write: timed out waiting for the writer lock at ${targetFilePath}.lock`)
      }
      await waitForRetry(delay, signal)
      delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
    }

    try {
      throwIfAborted(signal)
      await assertRegularTargetIfPresent(anchoredTarget, targetFilePath)
      throwIfAborted(signal)
      return await operation()
    } finally {
      if (acquired) await rm(lockPath, { force: true })
    }
  }, signal)
}

/**
 * Read a regular file through an opened file handle. The final component is
 * opened with O_NOFOLLOW where the platform provides it and the opened inode is
 * matched back to the canonical pathname before its bytes are exposed. On
 * POSIX the parent is descriptor-anchored, closing the parent-directory
 * validation/use race as well.
 */
export async function readSafeRegularFile(
  dirPath: string,
  targetFilePath: string,
  options: { readonly signal?: AbortSignal; readonly maxBytes?: number } = {},
): Promise<Buffer | null> {
  const { signal, maxBytes } = options
  throwIfAborted(signal)
  const targetName = directChildName(dirPath, targetFilePath)

  return withDirectoryAnchor(dirPath, async (anchor) => {
    throwIfAborted(signal)
    const anchoredTarget = resolve(anchor.path, targetName)
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    let file
    try {
      file = await open(anchoredTarget, constants.O_RDONLY | noFollow)
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      if (err?.code === 'ELOOP') {
        throw new Error(
          `Canonical target at "${targetFilePath}" must be a regular file, not a symbolic link or non-regular entry`,
        )
      }
      throw err
    }

    try {
      throwIfAborted(signal)
      const opened = await file.stat()
      if (!opened.isFile()) {
        throw new Error(
          `Canonical target at "${targetFilePath}" must be a regular file, not a symbolic link or non-regular entry`,
        )
      }
      if (maxBytes !== undefined && opened.size > maxBytes) {
        throw new Error(`Canonical target at "${targetFilePath}" exceeds maximum size limit of ${maxBytes} bytes (${opened.size} bytes)`)
      }

      const visible = await lstat(anchoredTarget)
      if (visible.isSymbolicLink() || !visible.isFile() || !sameIdentity(opened, visible)) {
        throw new Error(`Canonical target at "${targetFilePath}" changed while it was being opened`)
      }
      if (!anchor.descriptorAnchored) await assertDirectoryPathIdentity(dirPath, anchor.identity)
      throwIfAborted(signal)

      const buffer = await file.readFile()
      throwIfAborted(signal)
      if (maxBytes !== undefined && buffer.length > maxBytes) {
        throw new Error(`Canonical target at "${targetFilePath}" exceeds maximum size limit of ${maxBytes} bytes (${buffer.length} bytes)`)
      }
      return buffer
    } finally {
      await file.close()
    }
  }, signal)
}

/**
 * Atomically replaces one project-owned text file. The temporary inode and the
 * final rename are resolved through an opened canonical parent directory on
 * POSIX, so a concurrent pathname replacement cannot redirect the commit.
 * Cancellation is checked after the complete temp write and immediately before
 * the rename commit.
 */
export async function writeSafeFileAtomically(
  dirPath: string,
  targetFilePath: string,
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  const targetName = directChildName(dirPath, targetFilePath)

  await withDirectoryAnchor(dirPath, async (anchor) => {
    const anchoredTarget = resolve(anchor.path, targetName)
    await assertRegularTargetIfPresent(anchoredTarget, targetFilePath)
    throwIfAborted(signal)

    const tempPath = `${anchoredTarget}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(tempPath, buffer, { mode: 0o644, flag: 'wx' })
      throwIfAborted(signal)
      await rename(tempPath, anchoredTarget)
    } catch (error) {
      await rm(tempPath, { force: true })
      throw error
    }
  }, signal)
}

/**
 * Publish a complete new file without ever overwriting a concurrent external
 * creator. The content is fully written to a sibling temp inode first; a hard
 * link is then used as the atomic no-clobber publication point. Returns false
 * when another regular-file winner already owns the canonical pathname.
 */
export async function writeFileExclusiveAtomic(
  dirPath: string,
  targetFilePath: string,
  content: string | Buffer,
  options: ExclusiveAtomicWriteOptions,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal)
  const targetName = directChildName(dirPath, targetFilePath)

  return withDirectoryAnchor(dirPath, async (anchor) => {
    const anchoredTarget = resolve(anchor.path, targetName)
    const existing = await assertRegularTargetIfPresent(anchoredTarget, targetFilePath)
    if (existing !== undefined) return false
    throwIfAborted(signal)

    const tempPath = `${anchoredTarget}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(tempPath, content, { mode: options.mode, flag: 'wx' })
      throwIfAborted(signal)
      try {
        await link(tempPath, anchoredTarget)
        return true
      } catch (error: any) {
        if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
        const winner = await assertRegularTargetIfPresent(anchoredTarget, targetFilePath)
        if (winner === undefined) throw error
        return false
      }
    } finally {
      await rm(tempPath, { force: true })
    }
  }, signal)
}

/** Remove an existing regular canonical file without following a symlink. */
export async function removeSafeRegularFile(
  dirPath: string,
  targetFilePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal)
  const targetName = directChildName(dirPath, targetFilePath)
  return withDirectoryAnchor(dirPath, async (anchor) => {
    const anchoredTarget = resolve(anchor.path, targetName)
    const existing = await assertRegularTargetIfPresent(anchoredTarget, targetFilePath)
    if (existing === undefined) return false
    throwIfAborted(signal)
    await rm(anchoredTarget)
    return true
  }, signal)
}
