import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { lstat, mkdir } from 'node:fs/promises'

/**
 * Asserts that a canonical directory component, if present, is a real directory
 * and not a symbolic link, junction, or non-directory entry.
 * Returns true if directory exists and is valid, false if absent (ENOENT).
 */
export async function validateCanonicalDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await lstat(dirPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `Canonical path component at "${dirPath}" must be a real directory, not a symbolic link or non-directory entry`,
      )
    }
    return true
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return false
    }
    throw err
  }
}

/**
 * Ensures a canonical directory exists as a real directory without traversing
 * pre-existing symbolic links or non-directory entries.
 */
export async function ensureCanonicalDirectory(dirPath: string): Promise<void> {
  const exists = await validateCanonicalDirectory(dirPath)
  if (!exists) {
    try {
      await mkdir(dirPath)
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        const valid = await validateCanonicalDirectory(dirPath)
        if (!valid) {
          throw new Error(
            `Canonical path component at "${dirPath}" must be a real directory, not a symbolic link or non-directory entry`,
          )
        }
      } else {
        throw err
      }
    }
  }
}

/**
 * Run one complete writer operation while holding DSH's cross-process lock for
 * the exact target file. Every Project Memory writer that may race a
 * read-modify-write path uses this same `<target>.lock` namespace, so another
 * DSH process cannot commit between a read and the matching atomic replace.
 *
 * The canonical parent and existing target are revalidated after acquisition.
 * A missing target is legal; a pre-existing target must be a regular file.
 */
export async function withSafeFileWriterLock<T>(
  dirPath: string,
  targetFilePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!(await validateCanonicalDirectory(dirPath))) {
    throw new Error(`Canonical target directory at "${dirPath}" does not exist`)
  }

  return withFileLock(targetFilePath, async () => {
    if (!(await validateCanonicalDirectory(dirPath))) {
      throw new Error(`Canonical target directory at "${dirPath}" does not exist`)
    }

    try {
      const stats = await lstat(targetFilePath)
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(
          `Canonical target at "${targetFilePath}" must be a regular file, not a symbolic link or non-regular entry`,
        )
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err
    }

    return operation()
  })
}

/**
 * Atomically replaces one project-owned text file through the harness writer.
 * The canonical parent directory is revalidated immediately before the write,
 * and a pre-existing target must still be a regular file rather than a
 * symlink/non-regular entry. Project memory is repository content, so fresh
 * replacement inodes use normal owner-write/world-read file permissions.
 *
 * This primitive deliberately does not acquire a writer lock itself. Callers
 * that participate in read-modify-write coordination hold
 * {@link withSafeFileWriterLock} across the whole read/render/commit cycle.
 */
export async function writeSafeFileAtomically(
  dirPath: string,
  targetFilePath: string,
  buffer: Buffer,
): Promise<void> {
  if (!(await validateCanonicalDirectory(dirPath))) {
    throw new Error(`Canonical target directory at "${dirPath}" does not exist`)
  }

  try {
    const stats = await lstat(targetFilePath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Canonical target at "${targetFilePath}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }

  await writeFileAtomic(targetFilePath, buffer.toString('utf8'), { mode: 0o644 })
}
