import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
 * Writes data to a temporary file inside the target directory and atomically
 * renames it to targetFilePath. Temp filename contains no user secrets/content.
 * Cleans up temporary file on failure.
 */
export async function writeSafeFileAtomically(
  dirPath: string,
  targetFilePath: string,
  buffer: Buffer,
): Promise<void> {
  const tempPath = join(dirPath, `.tmp-${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, buffer, { flag: 'wx' })
    await rename(tempPath, targetFilePath)
  } finally {
    try {
      await rm(tempPath, { force: true })
    } catch {
      // Ignore temp cleanup errors
    }
  }
}
