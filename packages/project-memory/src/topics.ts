import { lstat, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ensureCanonicalDirectory,
  validateCanonicalDirectory,
  withSafeFileWriterLock,
  writeSafeFileAtomically,
} from './filesystem.js'
import { withMemoryMapEntryTransaction } from './bootstrap.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { isValidTopicIdentifier } from './topic-id.js'

export {
  TOPIC_IDENTIFIER_REGEX,
  MAX_TOPIC_IDENTIFIER_LENGTH,
  RESERVED_TOPIC_IDENTIFIERS,
  isValidTopicIdentifier,
} from './topic-id.js'

export const MAX_TOPIC_BYTES = 256 * 1024 // 256 KiB (262,144 bytes)

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

interface TopicSnapshot {
  exists: boolean
  content: Buffer | null
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

function topicContentBuffer(content: string): Buffer {
  if (typeof content !== 'string') {
    throw new Error('Topic memory content must be a string')
  }
  const contentBuffer = Buffer.from(content, 'utf8')
  if (contentBuffer.length > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic content exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${contentBuffer.length} bytes)`,
    )
  }
  return contentBuffer
}

async function readTopicSnapshotLocked(topicPath: string, topic: string): Promise<TopicSnapshot> {
  let stats
  try {
    stats = await lstat(topicPath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { exists: false, content: null }
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
  const content = await readFile(topicPath)
  if (content.length > MAX_TOPIC_BYTES) {
    throw new Error(
      `Topic memory file "${topicPath}" exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes (${content.length} bytes)`,
    )
  }
  return { exists: true, content }
}

async function writeTopicMemoryLocked(
  memoryDir: string,
  topicPath: string,
  topic: string,
  contentBuffer: Buffer,
): Promise<WriteTopicMemoryResult> {
  let created = false
  try {
    const stats = await lstat(topicPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Topic memory at "${topicPath}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') created = true
    else throw err
  }
  await writeSafeFileAtomically(memoryDir, topicPath, contentBuffer)
  return { created, path: topicPath, topic }
}

function renderExactTopicEdit(
  currentContent: string,
  topic: string,
  topicPath: string,
  oldText: string,
  newText: string,
): Buffer {
  const firstIndex = currentContent.indexOf(oldText)
  if (firstIndex === -1) {
    throw new Error(`Exact match for oldText not found in topic memory "${topic}" (${topicPath})`)
  }

  // Advance by +1 after each match to catch overlapping occurrences.
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
  return updatedBuffer
}

async function editTopicMemoryLocked(
  memoryDir: string,
  topicPath: string,
  topic: string,
  oldText: string,
  newText: string,
  snapshot?: TopicSnapshot,
): Promise<EditTopicMemoryResult> {
  const current = snapshot ?? await readTopicSnapshotLocked(topicPath, topic)
  if (!current.exists || current.content === null) {
    throw new Error(`Topic memory file "${topicPath}" does not exist; cannot edit missing topic`)
  }
  const updatedBuffer = renderExactTopicEdit(current.content.toString('utf8'), topic, topicPath, oldText, newText)
  await writeSafeFileAtomically(memoryDir, topicPath, updatedBuffer)
  return { topic, path: topicPath, bytesWritten: updatedBuffer.length }
}

async function restoreTopicSnapshotLocked(
  memoryDir: string,
  topicPath: string,
  snapshot: TopicSnapshot,
): Promise<void> {
  if (snapshot.exists && snapshot.content !== null) {
    await writeSafeFileAtomically(memoryDir, topicPath, snapshot.content)
    return
  }

  try {
    const stats = await lstat(topicPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Topic rollback target at "${topicPath}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
    await rm(topicPath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') return
    throw err
  }
}

async function rollbackTopicAfterMapFailure(
  topic: string,
  memoryDir: string,
  topicPath: string,
  snapshot: TopicSnapshot,
  mapError: unknown,
): Promise<never> {
  try {
    await restoreTopicSnapshotLocked(memoryDir, topicPath, snapshot)
  } catch (rollbackError) {
    throw new AggregateError(
      [mapError, rollbackError],
      `Project memory transaction for topic "${topic}" failed and topic rollback did not complete cleanly`,
      { cause: mapError },
    )
  }
  throw mapError
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
  if (!dshExists) return { exists: false, content: null, path: topicPath, topic }
  const memoryDirExists = await validateCanonicalDirectory(memoryDir)
  if (!memoryDirExists) return { exists: false, content: null, path: topicPath, topic }

  const snapshot = await readTopicSnapshotLocked(topicPath, topic)
  return {
    exists: snapshot.exists,
    content: snapshot.content?.toString('utf8') ?? null,
    path: topicPath,
    topic,
  }
}

/**
 * Writes a topic memory file whole-file atomically while honoring the same
 * cross-process writer lock used by exact edits of that topic. This low-level
 * operation does not mutate MEMORY.md; tool-level named-topic writes use
 * {@link writeTopicMemoryWithMap} for the compound transaction.
 */
export async function writeTopicMemory(
  projectRoot: string,
  topic: string,
  content: string,
): Promise<WriteTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const contentBuffer = topicContentBuffer(content)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  await ensureCanonicalDirectory(dshDir)
  await ensureCanonicalDirectory(memoryDir)

  return withSafeFileWriterLock(
    memoryDir,
    topicPath,
    () => writeTopicMemoryLocked(memoryDir, topicPath, topic, contentBuffer),
  )
}

/**
 * Edits a topic memory file by replacing one exact-string occurrence while
 * holding that topic's writer lock. This low-level operation does not mutate
 * MEMORY.md; tool-level named-topic edits use {@link editTopicMemoryWithMap}.
 */
export async function editTopicMemory(
  projectRoot: string,
  topic: string,
  oldText: string,
  newText: string,
): Promise<EditTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  if (typeof oldText !== 'string' || oldText.length === 0) throw new Error('oldText must be a non-empty string')
  if (typeof newText !== 'string') throw new Error('newText must be a string')
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  if (!(await validateCanonicalDirectory(dshDir))) {
    throw new Error(`Cannot edit topic memory: directory "${dshDir}" does not exist`)
  }
  if (!(await validateCanonicalDirectory(memoryDir))) {
    throw new Error(`Cannot edit topic memory: directory "${memoryDir}" does not exist`)
  }

  return withSafeFileWriterLock(
    memoryDir,
    topicPath,
    () => editTopicMemoryLocked(memoryDir, topicPath, topic, oldText, newText),
  )
}

/**
 * Whole-file named-topic write plus Memory-map update as one bounded compound
 * transaction. Lock order is always MEMORY.md -> topic.md. The Memory-map
 * render is preflighted before topic mutation. If its atomic commit then fails,
 * the topic is restored to its exact previous bytes (or removed if newly
 * created) while the topic lock is still held.
 */
export async function writeTopicMemoryWithMap(
  projectRoot: string,
  topic: string,
  content: string,
): Promise<WriteTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const contentBuffer = topicContentBuffer(content)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  await ensureCanonicalDirectory(dshDir)
  await ensureCanonicalDirectory(memoryDir)

  return withMemoryMapEntryTransaction(projectRoot, topic, async (commitMap) => {
    return withSafeFileWriterLock(memoryDir, topicPath, async () => {
      const snapshot = await readTopicSnapshotLocked(topicPath, topic)
      const result = await writeTopicMemoryLocked(memoryDir, topicPath, topic, contentBuffer)
      try {
        await commitMap()
      } catch (error) {
        await rollbackTopicAfterMapFailure(topic, memoryDir, topicPath, snapshot, error)
      }
      return result
    })
  })
}

/**
 * Exact named-topic edit plus Memory-map update under the same compound
 * transaction contract as {@link writeTopicMemoryWithMap}.
 */
export async function editTopicMemoryWithMap(
  projectRoot: string,
  topic: string,
  oldText: string,
  newText: string,
): Promise<EditTopicMemoryResult> {
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  if (typeof oldText !== 'string' || oldText.length === 0) throw new Error('oldText must be a non-empty string')
  if (typeof newText !== 'string') throw new Error('newText must be a string')
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  if (!(await validateCanonicalDirectory(dshDir))) {
    throw new Error(`Cannot edit topic memory: directory "${dshDir}" does not exist`)
  }
  if (!(await validateCanonicalDirectory(memoryDir))) {
    throw new Error(`Cannot edit topic memory: directory "${memoryDir}" does not exist`)
  }

  return withMemoryMapEntryTransaction(projectRoot, topic, async (commitMap) => {
    return withSafeFileWriterLock(memoryDir, topicPath, async () => {
      const snapshot = await readTopicSnapshotLocked(topicPath, topic)
      const result = await editTopicMemoryLocked(memoryDir, topicPath, topic, oldText, newText, snapshot)
      try {
        await commitMap()
      } catch (error) {
        await rollbackTopicAfterMapFailure(topic, memoryDir, topicPath, snapshot, error)
      }
      return result
    })
  })
}
