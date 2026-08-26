import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureCanonicalDirectory, validateCanonicalDirectory, writeSafeFileAtomically } from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'

export const TOPIC_IDENTIFIER_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
export const MAX_TOPIC_IDENTIFIER_LENGTH = 64
export const MAX_TOPIC_BYTES = 256 * 1024 // 256 KiB (262,144 bytes)

export const RESERVED_TOPIC_IDENTIFIERS = new Set<string>([
  'memory',
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

export interface ReadTopicMemoryResult {
  exists: boolean
  content: string | null
  path: string
  topic: string
}

export interface WriteTopicMemoryResult {
  created: boolean
  path: string
  topic: string
}

export interface EditTopicMemoryResult {
  topic: string
  path: string
  bytesWritten: number
}

/**
 * Validates a topic identifier against the approved flat topic contract:
 * - ASCII lowercase letters, digits, hyphen only
 * - regex: ^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$
 * - max 64 characters
 * - not a reserved identifier (memory, Windows device names)
 */
export function isValidTopicIdentifier(topic: string): boolean {
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > MAX_TOPIC_IDENTIFIER_LENGTH) {
    return false
  }
  if (RESERVED_TOPIC_IDENTIFIERS.has(topic.toLowerCase())) {
    return false
  }
  return TOPIC_IDENTIFIER_REGEX.test(topic)
}

/**
 * Deterministically resolves the canonical topic memory path:
 * PROJECT/.dsh/memory/<topic>.md
 * Fails closed on invalid topic identifier.
 */
export function resolveTopicMemoryPath(projectRoot: string, topic: string): string {
  if (!isValidTopicIdentifier(topic)) {
    throw new Error(
      `Invalid topic memory identifier "${topic}". Topic must match regex ^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$, be <= 64 characters, and not be a reserved identifier (e.g. "memory", Windows device names)`,
    )
  }
  const paths = resolveProjectMemoryPaths(projectRoot)
  return join(paths.memoryDir, `${topic}.md`)
}

/**
 * Reads a topic memory file under the 256 KiB cap.
 * Does not concatenate, does not auto-create missing files.
 * Fails closed with size error if content > 256 KiB (no silent truncation).
 * Fails closed if any canonical path component or file is a symlink or non-regular entry.
 */
export async function readTopicMemory(
  projectRoot: string,
  topic: string,
): Promise<ReadTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir

  const dshExists = await validateCanonicalDirectory(dshDir)
  if (!dshExists) {
    return {
      exists: false,
      content: null,
      path: topicPath,
      topic,
    }
  }

  const memoryDirExists = await validateCanonicalDirectory(memoryDir)
  if (!memoryDirExists) {
    return {
      exists: false,
      content: null,
      path: topicPath,
      topic,
    }
  }

  let stats
  try {
    stats = await lstat(topicPath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return {
        exists: false,
        content: null,
        path: topicPath,
        topic,
      }
    }
    throw err
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Topic memory at "${topicPath}" must be a regular file, not a symbolic link or non-regular entry`,
    )
  }

  if (stats.size > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic memory file "${topicPath}" exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${stats.size} bytes)`,
    )
  }

  const rawBuffer = await readFile(topicPath)
  if (rawBuffer.length > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic memory file "${topicPath}" exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${rawBuffer.length} bytes)`,
    )
  }

  return {
    exists: true,
    content: rawBuffer.toString('utf8'),
    path: topicPath,
    topic,
  }
}

/**
 * Writes a topic memory file whole-file atomically.
 * Creates canonical .dsh and .dsh/memory directories securely if absent.
 * Rejects content > 256 KiB before mutation.
 * Rejects pre-existing symlinks or non-regular entries.
 * Does not mutate MEMORY.md.
 */
export async function writeTopicMemory(
  projectRoot: string,
  topic: string,
  content: string,
): Promise<WriteTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  if (typeof content !== 'string') {
    throw new Error('Topic memory content must be a string')
  }

  const contentBuffer = Buffer.from(content, 'utf8')
  if (contentBuffer.length > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic content exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${contentBuffer.length} bytes)`,
    )
  }

  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir

  await ensureCanonicalDirectory(dshDir)
  await ensureCanonicalDirectory(memoryDir)

  let created = false
  try {
    const stats = await lstat(topicPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Topic memory at "${topicPath}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
    created = false
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      created = true
    } else {
      throw err
    }
  }

  await writeSafeFileAtomically(memoryDir, topicPath, contentBuffer)

  return {
    created,
    path: topicPath,
    topic,
  }
}

/**
 * Edits a topic memory file by replacing an exact-string occurrence.
 * Requires exactly one match of oldText (including overlapping matches).
 * 0 matches => fails with not found error.
 * >1 matches => fails with ambiguous error.
 * Resulting file must be <= 256 KiB.
 * Writes result atomically without mutating external targets or MEMORY.md.
 */
export async function editTopicMemory(
  projectRoot: string,
  topic: string,
  oldText: string,
  newText: string,
): Promise<EditTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)

  if (typeof oldText !== 'string' || oldText.length === 0) {
    throw new Error('oldText must be a non-empty string')
  }
  if (typeof newText !== 'string') {
    throw new Error('newText must be a string')
  }

  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir

  const dshExists = await validateCanonicalDirectory(dshDir)
  if (!dshExists) {
    throw new Error(`Cannot edit topic memory: directory "${dshDir}" does not exist`)
  }

  const memoryDirExists = await validateCanonicalDirectory(memoryDir)
  if (!memoryDirExists) {
    throw new Error(`Cannot edit topic memory: directory "${memoryDir}" does not exist`)
  }

  let stats
  try {
    stats = await lstat(topicPath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Topic memory file "${topicPath}" does not exist; cannot edit missing topic`)
    }
    throw err
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Topic memory at "${topicPath}" must be a regular file, not a symbolic link or non-regular entry`,
    )
  }

  if (stats.size > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic memory file "${topicPath}" exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${stats.size} bytes)`,
    )
  }

  const currentContent = await readFile(topicPath, 'utf8')
  const firstIndex = currentContent.indexOf(oldText)
  if (firstIndex === -1) {
    throw new Error(`Exact match for oldText not found in topic memory "${topic}" (${topicPath})`)
  }

  // Advance by +1 after each match to catch overlapping occurrences
  const secondIndex = currentContent.indexOf(oldText, firstIndex + 1)
  if (secondIndex !== -1) {
    let count = 2
    let pos = secondIndex + 1
    while (pos < currentContent.length) {
      const next = currentContent.indexOf(oldText, pos)
      if (next === -1) break
      count++
      pos = next + 1
    }
    throw new Error(
      `Multiple occurrences (${count}) of oldText found in topic memory "${topic}"; exact single match required`,
    )
  }

  const updatedContent =
    currentContent.slice(0, firstIndex) + newText + currentContent.slice(firstIndex + oldText.length)

  const updatedBuffer = Buffer.from(updatedContent, 'utf8')
  if (updatedBuffer.length > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic content after edit exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${updatedBuffer.length} bytes)`,
    )
  }

  await writeSafeFileAtomically(memoryDir, topicPath, updatedBuffer)

  return {
    topic,
    path: topicPath,
    bytesWritten: updatedBuffer.length,
  }
}
