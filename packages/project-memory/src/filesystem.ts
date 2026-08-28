import { randomBytes } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200
const DEFAULT_LOCK_WAIT_MS = 2_000

interface DirectoryAnchor {
  readonly path: string
  readonly identity: Stats
}

interface DirectoryAnchorOptions {
  readonly allowDirectorySymlink?: boolean
}

interface ParentDirectoryOptions {
  readonly allowParentDirectorySymlink?: boolean
}

export interface ExclusiveAtomicWriteOptions {
  readonly mode: number
}

export interface SafeReadOptions {
  readonly maxBytes?: number
}

export interface SafeDirectoryScope {
  readRegularFile(targetFilePath: string, options?: SafeReadOptions): Promise<Buffer | null>
  writeFileAtomically(targetFilePath: string, buffer: Buffer): Promise<void>
  writeFileExclusiveAtomic(
    targetFilePath: string,
    content: string | Buffer,
    options: ExclusiveAtomicWriteOptions,
  ): Promise<boolean>
  removeRegularFile(targetFilePath: string): Promise<boolean>
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

function createDirectoryScope(
  dirPath: string,
  anchor: DirectoryAnchor,
  signal?: AbortSignal,
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
      const result = await operation(createDirectoryScope(childDirPath, child.anchor, signal))
      await assertDirectoryPathIdentity(childDirPath, child.anchor.identity, false)
      return result
    } finally {
      await child.handle.close()
    }
  }

  const scope: SafeDirectoryScope = {
    async readRegularFile(targetFilePath, options = {}) {
      throwIfAborted(signal)
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

        let visible: Stats
        try {
          visible = await lstat(targetPath)
        } catch (error: any) {
          if (error?.code === 'ENOENT') {
            throw new Error(`Canonical target at "${targetFilePath}" changed while it was being opened`)
          }
          throw error
        }
        if (visible.isSymbolicLink() || !visible.isFile() || !sameIdentity(opened, visible)) {
          throw new Error(`Canonical target at "${targetFilePath}" changed while it was being opened`)
        }
        throwIfAborted(signal)

        const buffer = await file.readFile()
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

    async writeFileAtomically(targetFilePath, buffer) {
      throwIfAborted(signal)
      const targetPath = anchoredPath(targetFilePath)
      await assertRegularTargetIfPresent(targetPath, targetFilePath)
      throwIfAborted(signal)

      const tempPath = `${targetPath}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tempPath, buffer, { mode: 0o644, flag: 'wx' })
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

    async withWriterLock<T>(
      targetFilePath: string,
      operation: (lockedScope: SafeDirectoryScope) => Promise<T>,
    ): Promise<T> {
      throwIfAborted(signal)
      const targetPath = anchoredPath(targetFilePath)
      const lockPath = `${targetPath}.lock`
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
        await assertRegularTargetIfPresent(targetPath, targetFilePath)
        throwIfAborted(signal)
        return await operation(scope)
      } finally {
        if (acquired) await rm(lockPath, { force: true })
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
      return createDirectoryScope(dirPath, anchor)
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
  return withDirectoryAnchor(
    dirPath,
    async (anchor) => operation(createDirectoryScope(dirPath, anchor, signal)),
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
    readonly allowDirectorySymlink?: boolean
  } = {},
): Promise<Buffer | null> {
  return withSafeDirectoryScope(
    dirPath,
    (scope) => scope.readRegularFile(targetFilePath, { maxBytes: options.maxBytes }),
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
