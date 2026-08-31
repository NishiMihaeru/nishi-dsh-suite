import { randomBytes } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { currentProcessIdentity } from './process-identity.js'

const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200
// One `memory_write`/`memory_edit` compound transaction holds the MEMORY.md
// lock for the whole operation while it also does a WAL journal publish plus
// two atomic participant writes (topic file, then Memory-map file) under that
// same lock. On a slow disk, or with several agents contending for the same
// project, that held critical section can comfortably exceed a couple of
// seconds, so the default wait budget for a *different* caller queued behind
// it needs enough headroom to not spuriously time out.
const DEFAULT_LOCK_WAIT_MS = 10_000
const WRITER_LOCK_VERSION = 1
const MAX_LOCK_OWNER_BYTES = 1024

interface DirectoryAnchor {
  readonly path: string
  readonly identity: Stats
}

interface DirectoryAnchorOptions {
  readonly allowDirectorySymlink?: boolean
  /** Overrides DEFAULT_LOCK_WAIT_MS for writer-lock waits opened through this scope. */
  readonly lockWaitMs?: number
}

interface ParentDirectoryOptions {
  readonly allowParentDirectorySymlink?: boolean
}

export interface ExclusiveAtomicWriteOptions {
  readonly mode: number
}

export interface SafeAtomicWriteOptions {
  readonly mode?: number
}

export interface SafeReadOptions {
  /** Reject a file whose complete size exceeds this bound. */
  readonly maxBytes?: number
  /** Read at most this prefix after validating the opened file identity. */
  readonly prefixBytes?: number
  /**
   * TEST-ONLY seam. When provided, invoked after the opened descriptor has
   * been `stat()`'d but before the canonical pathname's current visibility
   * is re-checked via `lstat()`. This is the narrow window in which another
   * process can atomically replace the target, so a test can use this hook
   * to deterministically land a replacement inside that window instead of
   * relying on timing. Production code must never set this option.
   */
  readonly testOnlyAfterDescriptorStatHook?: () => Promise<void>
}

/**
 * Thrown by `readRegularFile` when the canonical pathname was found, after
 * open, to now resolve to a *different regular file* than the one that was
 * opened (i.e. another process atomically replaced it, typically via
 * `rename()` over the same path). This is distinct from replacement by a
 * symlink or other non-regular entry, which stays a generic fail-closed
 * `Error` -- that case is a genuine security-relevant event. Replacement by
 * another regular file is the ordinary, expected result of a concurrent
 * atomic rewrite and callers that read without holding a lock (a pre-claim
 * probe, for example) may legitimately treat it as a signal to re-observe
 * rather than fail.
 */
export class CanonicalRegularFileReplacedError extends Error {
  readonly code = 'CANONICAL_REGULAR_FILE_REPLACED'

  constructor(targetFilePath: string) {
    super(`Canonical target at "${targetFilePath}" was replaced by a different regular file while it was being opened`)
    this.name = 'CanonicalRegularFileReplacedError'
  }
}

export interface WriterLockOwner {
  readonly format: 'v1' | 'legacy'
  readonly pid: number
  readonly processIdentity?: string
  readonly token?: string
  /** Internal owner marker name for v1 directory locks. */
  readonly markerName?: string
}

export interface SafeDirectoryScope {
  readRegularFile(targetFilePath: string, options?: SafeReadOptions): Promise<Buffer | null>
  writeFileAtomically(
    targetFilePath: string,
    buffer: Buffer,
    options?: SafeAtomicWriteOptions,
  ): Promise<void>
  writeFileExclusiveAtomic(
    targetFilePath: string,
    content: string | Buffer,
    options: ExclusiveAtomicWriteOptions,
  ): Promise<boolean>
  removeRegularFile(targetFilePath: string): Promise<boolean>
  readWriterLockOwner(targetFilePath: string): Promise<WriterLockOwner | null>
  removeWriterLockIfOwnedBy(targetFilePath: string, owner: WriterLockOwner): Promise<boolean>
  withWriterLock<T>(
    targetFilePath: string,
    operation: (scope: SafeDirectoryScope) => Promise<T>,
  ): Promise<T>
  withExistingChildDirectory<T>(
    childDirPath: string,
    operation: (scope: SafeDirectoryScope) => Promise<T>,
  ): Promise<T | undefined>
  withEnsuredChildDirectory<T>(
    childDirPath: string,
    operation: (scope: SafeDirectoryScope) => Promise<T>,
  ): Promise<T>
  /** Same opened directory identity, but no caller AbortSignal checks. Use only to settle already-durable state. */
  forSettlement(): SafeDirectoryScope
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertDirectory(stats: Stats, dirPath: string, allowDirectorySymlink: boolean): void {
  if (!stats.isDirectory() || (!allowDirectorySymlink && stats.isSymbolicLink())) {
    throw new Error(
      allowDirectorySymlink
        ? `Directory at "${dirPath}" must resolve to a directory`
        : `Canonical path component at "${dirPath}" must be a real directory, not a symbolic link or non-directory entry`,
    )
  }
}

async function directoryStats(
  dirPath: string,
  allowDirectorySymlink: boolean,
): Promise<Stats | undefined> {
  try {
    const stats = allowDirectorySymlink ? await stat(dirPath) : await lstat(dirPath)
    assertDirectory(stats, dirPath, allowDirectorySymlink)
    return stats
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined
    throw err
  }
}

async function canonicalDirectoryStats(dirPath: string): Promise<Stats | undefined> {
  return directoryStats(dirPath, false)
}

async function assertDirectoryPathIdentity(
  dirPath: string,
  expected: Stats,
  allowDirectorySymlink: boolean,
): Promise<void> {
  let current: Stats
  try {
    current = allowDirectorySymlink ? await stat(dirPath) : await lstat(dirPath)
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new Error(`Directory at "${dirPath}" changed during the filesystem operation`)
    }
    throw error
  }
  assertDirectory(current, dirPath, allowDirectorySymlink)
  if (!sameIdentity(current, expected)) {
    throw new Error(`Directory at "${dirPath}" changed during the filesystem operation`)
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

async function openChildAnchor(
  logicalParentPath: string,
  parentAnchor: DirectoryAnchor,
  childDirPath: string,
  create: boolean,
  signal?: AbortSignal,
): Promise<{ anchor: DirectoryAnchor; handle: FileHandle } | undefined> {
  throwIfAborted(signal)
  const childName = directChildName(logicalParentPath, childDirPath)
  const anchoredChildPath = resolve(parentAnchor.path, childName)

  let before: Stats
  try {
    before = await lstat(anchoredChildPath)
  } catch (error: any) {
    if (error?.code !== 'ENOENT' || !create) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    try {
      await mkdir(anchoredChildPath)
    } catch (mkdirError: any) {
      if (mkdirError?.code !== 'EEXIST') throw mkdirError
    }
    before = await lstat(anchoredChildPath)
  }
  assertDirectory(before, childDirPath, false)
  throwIfAborted(signal)

  const handle = await open(anchoredChildPath, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    const opened = await handle.stat()
    if (!opened.isDirectory() || !sameIdentity(before, opened)) {
      throw new Error(`Directory at "${childDirPath}" changed while it was being opened`)
    }
    const visible = await lstat(anchoredChildPath)
    assertDirectory(visible, childDirPath, false)
    if (!sameIdentity(opened, visible)) {
      throw new Error(`Directory at "${childDirPath}" changed while it was being opened`)
    }
    throwIfAborted(signal)
    const descriptorPath = await descriptorAnchorPath(handle.fd, opened)
    return {
      handle,
      anchor: {
        path: descriptorPath ?? anchoredChildPath,
        identity: opened,
      },
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function withDirectoryAnchor<T>(
  dirPath: string,
  operation: (anchor: DirectoryAnchor) => Promise<T>,
  signal?: AbortSignal,
  options: DirectoryAnchorOptions = {},
): Promise<T> {
  throwIfAborted(signal)
  const allowDirectorySymlink = options.allowDirectorySymlink === true
  const before = await directoryStats(dirPath, allowDirectorySymlink)
  if (before === undefined) {
    throw new Error(`Target directory at "${dirPath}" does not exist`)
  }
  throwIfAborted(signal)

  if (process.platform === 'win32') {
    const result = await operation({ path: dirPath, identity: before })
    await assertDirectoryPathIdentity(dirPath, before, allowDirectorySymlink)
    return result
  }

  const directory = await open(dirPath, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    const opened = await directory.stat()
    if (!opened.isDirectory() || !sameIdentity(before, opened)) {
      throw new Error(`Directory at "${dirPath}" changed while it was being opened`)
    }
    await assertDirectoryPathIdentity(dirPath, opened, allowDirectorySymlink)
    throwIfAborted(signal)

    const descriptorPath = await descriptorAnchorPath(directory.fd, opened)
    const anchor: DirectoryAnchor = {
      path: descriptorPath ?? dirPath,
      identity: opened,
    }
    const result = await operation(anchor)
    await assertDirectoryPathIdentity(dirPath, opened, allowDirectorySymlink)
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function isLockRenameContention(error: unknown, lockPath: string): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException | null)?.code
  // These are authoritative destination-collision results for renaming our
  // prepared lock directory. Do not re-stat the pathname: the holder may
  // legitimately release it between rename() and any follow-up lstat().
  if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'ENOTDIR' || code === 'EISDIR') {
    return true
  }
  if (code !== 'EPERM' && code !== 'EACCES') return false
  // Some platforms report an existing destination as EPERM/EACCES. Keep the
  // existence check only for those ambiguous codes, where it distinguishes
  // contention from a real permission failure.
  return pathExists(lockPath)
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

function assertBound(value: number | undefined, name: string, minimum = 0): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(
      minimum > 0
        ? `${name} must be a positive safe integer`
        : `${name} must be a non-negative safe integer`,
    )
  }
}

function parseLegacyLockOwner(buffer: Buffer, logicalLockPath: string): WriterLockOwner {
  const text = buffer.toString('utf8').trim()
  if (!/^\d+$/.test(text)) {
    throw new Error(`Malformed legacy project memory writer lock at "${logicalLockPath}"`)
  }
  const pid = Number(text)
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Malformed legacy project memory writer lock at "${logicalLockPath}"`)
  }
  return { format: 'legacy', pid }
}

function parseV1LockOwner(buffer: Buffer, markerName: string, logicalLockPath: string): WriterLockOwner {
  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error(`Malformed project memory writer lock at "${logicalLockPath}"`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Malformed project memory writer lock at "${logicalLockPath}"`)
  }
  const fields = parsed as Record<string, unknown>
  const allowed = new Set(['version', 'pid', 'processIdentity', 'token'])
  if (Object.keys(fields).some((key) => !allowed.has(key))) {
    throw new Error(`Malformed project memory writer lock at "${logicalLockPath}"`)
  }
  if (
    fields.version !== WRITER_LOCK_VERSION
    || !Number.isSafeInteger(fields.pid)
    || (fields.pid as number) <= 0
    || typeof fields.token !== 'string'
    || fields.token.length === 0
    || fields.token.length > 256
    || (fields.processIdentity !== undefined
      && (typeof fields.processIdentity !== 'string'
        || fields.processIdentity.length === 0
        || fields.processIdentity.length > 512))
  ) {
    throw new Error(`Malformed project memory writer lock at "${logicalLockPath}"`)
  }
  return {
    format: 'v1',
    pid: fields.pid as number,
    token: fields.token,
    ...(fields.processIdentity === undefined ? {} : { processIdentity: fields.processIdentity as string }),
    markerName,
  }
}

function sameLockOwner(left: WriterLockOwner, right: WriterLockOwner): boolean {
  if (left.format !== right.format || left.pid !== right.pid) return false
  if (left.format === 'legacy') return true
  return left.token === right.token && left.processIdentity === right.processIdentity
}

function createDirectoryScope(
  dirPath: string,
  anchor: DirectoryAnchor,
  signal?: AbortSignal,
  lockWaitMs?: number,
): SafeDirectoryScope {
  const anchoredPath = (targetFilePath: string): string => {
    const targetName = directChildName(dirPath, targetFilePath)
    return resolve(anchor.path, targetName)
  }

  async function withChildDirectory<T>(
    childDirPath: string,
    operation: (scope: SafeDirectoryScope) => Promise<T>,
    create: boolean,
  ): Promise<T | undefined> {
    const child = await openChildAnchor(dirPath, anchor, childDirPath, create, signal)
    if (child === undefined) return undefined
    try {
      const result = await operation(createDirectoryScope(childDirPath, child.anchor, signal, lockWaitMs))
      await assertDirectoryPathIdentity(childDirPath, child.anchor.identity, false)
      return result
    } finally {
      await child.handle.close()
    }
  }

  async function readWriterLockOwnerImpl(targetFilePath: string): Promise<WriterLockOwner | null> {
    throwIfAborted(signal)
    const logicalLockPath = `${targetFilePath}.lock`
    const lockPath = anchoredPath(logicalLockPath)
    let lockStats: Stats
    try {
      lockStats = await lstat(lockPath)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    if (lockStats.isSymbolicLink()) {
      throw new Error(`Project memory writer lock at "${logicalLockPath}" must not be a symbolic link`)
    }
    if (lockStats.isFile()) {
      const legacy = await scope.readRegularFile(logicalLockPath, { maxBytes: 128 })
      if (legacy === null) return null
      return parseLegacyLockOwner(legacy, logicalLockPath)
    }
    if (!lockStats.isDirectory()) {
      throw new Error(`Project memory writer lock at "${logicalLockPath}" has an unsupported filesystem type`)
    }

    const child = await openChildAnchor(dirPath, anchor, logicalLockPath, false, signal)
    if (child === undefined) return null
    try {
      const entries = await readdir(child.anchor.path)
      // An EMPTY lock directory is a normal transient state, not a malformed
      // lock. Release unlinks the owner marker and only then removes the
      // directory, so a concurrent reader lands between the two; treating that
      // as malformed failed an unrelated caller's memory operation, which is the
      // same shape as the recovery race fixed in `e38ce06`.
      //
      // Reporting "no owner" here cannot weaken exclusion, because exclusion is
      // not this read: a writer takes the lock by creating its marker through an
      // atomic `link()`, which fails for everyone but the winner whatever this
      // function says. Both callers are safe with `null` -- dead-lock reclaim
      // does nothing, and owned-removal declines.
      if (entries.length === 0) return null
      if (entries.length !== 1 || !/^owner-[A-Za-z0-9._-]+\.json$/.test(entries[0] ?? '')) {
        throw new Error(`Malformed project memory writer lock at "${logicalLockPath}"`)
      }
      const markerName = entries[0]
      const childScope = createDirectoryScope(logicalLockPath, child.anchor, signal, lockWaitMs)
      const marker = await childScope.readRegularFile(
        join(logicalLockPath, markerName),
        { maxBytes: MAX_LOCK_OWNER_BYTES },
      )
      if (marker === null) {
        throw new Error(`Project memory writer lock at "${logicalLockPath}" changed while it was being read`)
      }
      return parseV1LockOwner(marker, markerName, logicalLockPath)
    } finally {
      await child.handle.close()
    }
  }

  async function removeWriterLockIfOwnedByImpl(
    targetFilePath: string,
    expectedOwner: WriterLockOwner,
  ): Promise<boolean> {
    throwIfAborted(signal)
    const logicalLockPath = `${targetFilePath}.lock`
    const lockPath = anchoredPath(logicalLockPath)
    let currentStats: Stats
    try {
      currentStats = await lstat(lockPath)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false
      throw error
    }

    if (expectedOwner.format === 'legacy') {
      if (currentStats.isSymbolicLink() || !currentStats.isFile()) return false
      const currentOwner = await readWriterLockOwnerImpl(targetFilePath)
      if (currentOwner === null || !sameLockOwner(currentOwner, expectedOwner)) return false
      // Compatibility cleanup for locks created by pre-generation builds.
      // Current writers never create this format, so a replacement current
      // lock is a directory and cannot be unlinked by this regular-file rm.
      try {
        await rm(lockPath)
        return true
      } catch (error: any) {
        if (error?.code === 'ENOENT' || error?.code === 'EISDIR' || error?.code === 'EPERM') return false
        throw error
      }
    }

    if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) return false
    const child = await openChildAnchor(dirPath, anchor, logicalLockPath, false, signal)
    if (child === undefined) return false
    let openedIdentity: Stats | undefined
    try {
      const entries = await readdir(child.anchor.path)
      if (entries.length !== 1 || !/^owner-[A-Za-z0-9._-]+\.json$/.test(entries[0] ?? '')) return false
      const markerName = entries[0]
      const childScope = createDirectoryScope(logicalLockPath, child.anchor, signal, lockWaitMs)
      const markerPath = join(logicalLockPath, markerName)
      const marker = await childScope.readRegularFile(markerPath, { maxBytes: MAX_LOCK_OWNER_BYTES })
      if (marker === null) return false
      const currentOwner = parseV1LockOwner(marker, markerName, logicalLockPath)
      if (!sameLockOwner(currentOwner, expectedOwner)) return false
      if (!await childScope.removeRegularFile(markerPath)) return false
      openedIdentity = child.anchor.identity
    } finally {
      await child.handle.close()
    }

    if (openedIdentity === undefined) return false
    let visible: Stats
    try {
      visible = await lstat(lockPath)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return true
      throw error
    }
    if (!visible.isDirectory() || visible.isSymbolicLink() || !sameIdentity(visible, openedIdentity)) {
      return false
    }
    try {
      await rmdir(lockPath)
      return true
    } catch (error: any) {
      // A legitimate replacement owner is always a populated directory. If
      // it appeared after the identity check, rmdir fails rather than deleting
      // that new owner's generation.
      if (error?.code === 'ENOENT') return true
      if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST' || error?.code === 'ENOTDIR') return false
      throw error
    }
  }

  const scope: SafeDirectoryScope = {
    async readRegularFile(targetFilePath, options = {}) {
      throwIfAborted(signal)
      assertBound(options.maxBytes, 'maxBytes')
      assertBound(options.prefixBytes, 'prefixBytes')
      const targetPath = anchoredPath(targetFilePath)
      const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
      let file: FileHandle
      try {
        file = await open(targetPath, constants.O_RDONLY | noFollow)
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
        if (options.maxBytes !== undefined && opened.size > options.maxBytes) {
          throw new Error(
            `Canonical target at "${targetFilePath}" exceeds maximum size limit of ${options.maxBytes} bytes (${opened.size} bytes)`,
          )
        }

        if (options.testOnlyAfterDescriptorStatHook !== undefined) {
          await options.testOnlyAfterDescriptorStatHook()
        }

        let visible: Stats
        try {
          visible = await lstat(targetPath)
        } catch (error: any) {
          // A concurrent unlink after open means the canonical pathname is now
          // absent. Returning null reflects current namespace state and avoids
          // exposing stale bytes from the already-unlinked inode. Replacement
          // by another inode/symlink is still rejected below.
          if (error?.code === 'ENOENT') return null
          throw error
        }
        // Replacement by a symlink or other non-regular entry is a genuine
        // security-relevant event and always fails closed with a generic
        // error, regardless of whether anyone holds a lock.
        if (visible.isSymbolicLink() || !visible.isFile()) {
          throw new Error(`Canonical target at "${targetFilePath}" changed while it was being opened`)
        }
        // Replacement by a *different regular file* (e.g. another process's
        // atomic rename over the same path) is distinguished so an unlocked,
        // pre-claim caller can recognise it and re-observe instead of failing
        // an unrelated operation. Locked callers that need to fail closed on
        // this too can still do so by checking the error type.
        if (!sameIdentity(opened, visible)) {
          throw new CanonicalRegularFileReplacedError(targetFilePath)
        }
        throwIfAborted(signal)

        let buffer: Buffer
        if (options.prefixBytes === undefined) {
          buffer = await file.readFile()
        } else if (options.prefixBytes === 0 || opened.size === 0) {
          buffer = Buffer.alloc(0)
        } else {
          const length = Math.min(options.prefixBytes, opened.size)
          buffer = Buffer.alloc(length)
          const { bytesRead } = await file.read(buffer, 0, length, 0)
          buffer = buffer.subarray(0, bytesRead)
        }
        throwIfAborted(signal)
        if (options.maxBytes !== undefined && buffer.length > options.maxBytes) {
          throw new Error(
            `Canonical target at "${targetFilePath}" exceeds maximum size limit of ${options.maxBytes} bytes (${buffer.length} bytes)`,
          )
        }
        return buffer
      } finally {
        await file.close()
      }
    },

    async writeFileAtomically(targetFilePath, buffer, options = {}) {
      throwIfAborted(signal)
      const targetPath = anchoredPath(targetFilePath)
      await assertRegularTargetIfPresent(targetPath, targetFilePath)
      throwIfAborted(signal)

      const tempPath = `${targetPath}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tempPath, buffer, { mode: options.mode ?? 0o644, flag: 'wx' })
        throwIfAborted(signal)
        await rename(tempPath, targetPath)
      } catch (error) {
        await rm(tempPath, { force: true })
        throw error
      }
    },

    async writeFileExclusiveAtomic(targetFilePath, content, options) {
      throwIfAborted(signal)
      const targetPath = anchoredPath(targetFilePath)
      const existing = await assertRegularTargetIfPresent(targetPath, targetFilePath)
      if (existing !== undefined) return false
      throwIfAborted(signal)

      const tempPath = `${targetPath}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tempPath, content, { mode: options.mode, flag: 'wx' })
        throwIfAborted(signal)
        try {
          await link(tempPath, targetPath)
          return true
        } catch (error: any) {
          if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
          const winner = await assertRegularTargetIfPresent(targetPath, targetFilePath)
          if (winner === undefined) throw error
          return false
        }
      } finally {
        await rm(tempPath, { force: true })
      }
    },

    async removeRegularFile(targetFilePath) {
      throwIfAborted(signal)
      const targetPath = anchoredPath(targetFilePath)
      const existing = await assertRegularTargetIfPresent(targetPath, targetFilePath)
      if (existing === undefined) return false
      throwIfAborted(signal)
      try {
        await rm(targetPath)
        return true
      } catch (error: any) {
        if (error?.code === 'ENOENT') return false
        throw error
      }
    },

    readWriterLockOwner(targetFilePath) {
      return readWriterLockOwnerImpl(targetFilePath)
    },

    removeWriterLockIfOwnedBy(targetFilePath, owner) {
      return removeWriterLockIfOwnedByImpl(targetFilePath, owner)
    },

    async withWriterLock<T>(
      targetFilePath: string,
      operation: (lockedScope: SafeDirectoryScope) => Promise<T>,
    ): Promise<T> {
      throwIfAborted(signal)
      const targetPath = anchoredPath(targetFilePath)
      const logicalLockPath = `${targetFilePath}.lock`
      const lockPath = anchoredPath(logicalLockPath)
      const deadline = Date.now() + (lockWaitMs ?? DEFAULT_LOCK_WAIT_MS)
      let delay = LOCK_RETRY_INITIAL_MS
      const token = randomBytes(16).toString('hex')
      const processIdentity = await currentProcessIdentity()
      const owner: WriterLockOwner = {
        format: 'v1',
        pid: process.pid,
        token,
        ...(processIdentity === undefined ? {} : { processIdentity }),
        markerName: `owner-${token}.json`,
      }
      let acquired = false

      for (;;) {
        throwIfAborted(signal)
        const tempLockPath = `${lockPath}.${randomBytes(6).toString('hex')}.tmp`
        let published = false
        try {
          await mkdir(tempLockPath, { mode: 0o700 })
          const marker = {
            version: WRITER_LOCK_VERSION,
            pid: owner.pid,
            ...(owner.processIdentity === undefined ? {} : { processIdentity: owner.processIdentity }),
            token,
          }
          await writeFile(
            join(tempLockPath, owner.markerName!),
            JSON.stringify(marker) + '\n',
            { mode: 0o600, flag: 'wx' },
          )
          try {
            await rename(tempLockPath, lockPath)
            published = true
            acquired = true
            break
          } catch (error) {
            if (!await isLockRenameContention(error, lockPath)) throw error
          }
        } finally {
          if (!published) await rm(tempLockPath, { recursive: true, force: true })
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
        await assertRegularTargetIfPresent(targetPath, targetFilePath)
        throwIfAborted(signal)
        return await operation(scope)
      } finally {
        if (acquired) {
          // Lock settlement must not inherit caller cancellation. The expected
          // generation token prevents a delayed finalizer from removing a
          // replacement owner's lock.
          await createDirectoryScope(dirPath, anchor).removeWriterLockIfOwnedBy(targetFilePath, owner)
        }
      }
    },

    async withExistingChildDirectory<T>(
      childDirPath: string,
      operation: (childScope: SafeDirectoryScope) => Promise<T>,
    ): Promise<T | undefined> {
      return withChildDirectory(childDirPath, operation, false)
    },

    async withEnsuredChildDirectory<T>(
      childDirPath: string,
      operation: (childScope: SafeDirectoryScope) => Promise<T>,
    ): Promise<T> {
      let completed = false
      let value!: T
      await withChildDirectory(childDirPath, async (childScope) => {
        value = await operation(childScope)
        completed = true
      }, true)
      if (!completed) {
        throw new Error(`Canonical directory at "${childDirPath}" was not created`)
      }
      return value
    },

    forSettlement() {
      return createDirectoryScope(dirPath, anchor, undefined, lockWaitMs)
    },
  }

  return scope
}

/**
 * Run multiple child operations against one opened parent-directory identity.
 * Child scopes can only be opened through this pinned parent, which prevents an
 * intermediate canonical component swap from redirecting descendant I/O.
 */
export async function withSafeDirectoryScope<T>(
  dirPath: string,
  operation: (scope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
  options: DirectoryAnchorOptions = {},
): Promise<T> {
  assertBound(options.lockWaitMs, 'lockWaitMs', 1)
  return withDirectoryAnchor(
    dirPath,
    async (anchor) => operation(createDirectoryScope(dirPath, anchor, signal, options.lockWaitMs)),
    signal,
    options,
  )
}

export async function validateCanonicalDirectory(dirPath: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  const stats = await canonicalDirectoryStats(dirPath)
  throwIfAborted(signal)
  return stats !== undefined
}

export async function ensureCanonicalDirectory(
  dirPath: string,
  signal?: AbortSignal,
  options: ParentDirectoryOptions = {},
): Promise<void> {
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
  }, signal, { allowDirectorySymlink: options.allowParentDirectorySymlink === true })

  throwIfAborted(signal)
  const created = await canonicalDirectoryStats(dirPath)
  if (created === undefined) {
    throw new Error(`Canonical directory at "${dirPath}" was not created`)
  }
}

export async function withSafeFileWriterLock<T>(
  dirPath: string,
  targetFilePath: string,
  operation: (scope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
  options: DirectoryAnchorOptions = {},
): Promise<T> {
  return withSafeDirectoryScope(
    dirPath,
    (scope) => scope.withWriterLock(targetFilePath, operation),
    signal,
    options,
  )
}

export async function readSafeRegularFile(
  dirPath: string,
  targetFilePath: string,
  options: {
    readonly signal?: AbortSignal
    readonly maxBytes?: number
    readonly prefixBytes?: number
    readonly allowDirectorySymlink?: boolean
  } = {},
): Promise<Buffer | null> {
  return withSafeDirectoryScope(
    dirPath,
    (scope) => scope.readRegularFile(targetFilePath, {
      maxBytes: options.maxBytes,
      prefixBytes: options.prefixBytes,
    }),
    options.signal,
    { allowDirectorySymlink: options.allowDirectorySymlink === true },
  )
}

export async function writeSafeFileAtomically(
  dirPath: string,
  targetFilePath: string,
  buffer: Buffer,
  signal?: AbortSignal,
  options: DirectoryAnchorOptions = {},
): Promise<void> {
  await withSafeDirectoryScope(
    dirPath,
    (scope) => scope.writeFileAtomically(targetFilePath, buffer),
    signal,
    options,
  )
}

export async function writeFileExclusiveAtomic(
  dirPath: string,
  targetFilePath: string,
  content: string | Buffer,
  options: ExclusiveAtomicWriteOptions,
  signal?: AbortSignal,
  directoryOptions: DirectoryAnchorOptions = {},
): Promise<boolean> {
  return withSafeDirectoryScope(
    dirPath,
    (scope) => scope.writeFileExclusiveAtomic(targetFilePath, content, options),
    signal,
    directoryOptions,
  )
}

export async function removeSafeRegularFile(
  dirPath: string,
  targetFilePath: string,
  signal?: AbortSignal,
  options: DirectoryAnchorOptions = {},
): Promise<boolean> {
  return withSafeDirectoryScope(
    dirPath,
    (scope) => scope.removeRegularFile(targetFilePath),
    signal,
    options,
  )
}
