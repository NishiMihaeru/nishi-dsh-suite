import { join } from 'node:path'
import {
  ensureCanonicalDirectory,
  readSafeRegularFile,
  validateCanonicalDirectory,
  withSafeFileWriterLock,
  writeSafeFileAtomically,
} from './filesystem.js'
import { withMemoryMapEntryTransaction } from './bootstrap.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { isValidTopicIdentifier } from './topic-id.js'
import {
  clearPendingProjectMemoryTransaction,
  createPendingProjectMemoryTransaction,
  markProjectMemoryTransactionCommitted,
  recoverPendingProjectMemoryTransaction,
  restorePendingProjectMemoryTransactionLocked,
  type PendingProjectMemoryTransaction,
} from './transaction.js'

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

async function readTopicSnapshotLocked(
  memoryDir: string,
  topicPath: string,
  topic: string,
  signal?: AbortSignal,
): Promise<TopicSnapshot> {
  signal?.throwIfAborted()
  try {
    const content = await readSafeRegularFile(memoryDir, topicPath, {
      signal,
      maxBytes: MAX_TOPIC_BYTES,
    })
    if (content === null) return { exists: false, content: null }
    return { exists: true, content }
  } catch (error: any) {
    if (signal?.aborted) signal.throwIfAborted()
    if (typeof error?.message === 'string' && error.message.includes('exceeds maximum size limit')) {
      throw new Error(
        `Topic memory file "${topicPath}" exceeds maximum size limit of ${MAX_TOPIC_BYTES} bytes`,
      )
    }
    throw error
  }
}

async function writeTopicMemoryLocked(
  memoryDir: string,
  topicPath: string,
  topic: string,
  contentBuffer: Buffer,
  snapshot: TopicSnapshot,
  signal?: AbortSignal,
): Promise<WriteTopicMemoryResult> {
  signal?.throwIfAborted()
  await writeSafeFileAtomically(memoryDir, topicPath, contentBuffer, signal)
  return { created: !snapshot.exists, path: topicPath, topic }
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
  snapshot: TopicSnapshot,
  signal?: AbortSignal,
): Promise<EditTopicMemoryResult> {
  if (!snapshot.exists || snapshot.content === null) {
    throw new Error(`Topic memory file "${topicPath}" does not exist; cannot edit missing topic`)
  }
  const updatedBuffer = renderExactTopicEdit(snapshot.content.toString('utf8'), topic, topicPath, oldText, newText)
  signal?.throwIfAborted()
  await writeSafeFileAtomically(memoryDir, topicPath, updatedBuffer, signal)
  return { topic, path: topicPath, bytesWritten: updatedBuffer.length }
}

async function rollbackJournaledTransaction(
  projectRoot: string,
  topic: string,
  journal: PendingProjectMemoryTransaction,
  originalError: unknown,
): Promise<never> {
  try {
    await restorePendingProjectMemoryTransactionLocked(projectRoot, journal)
    await clearPendingProjectMemoryTransaction(projectRoot)
  } catch (rollbackError) {
    throw new AggregateError(
      [originalError, rollbackError],
      `Project memory transaction for topic "${topic}" failed and rollback did not complete cleanly`,
      { cause: originalError },
    )
  }
  throw originalError
}

async function clearCommittedJournalBestEffort(projectRoot: string): Promise<void> {
  try {
    await clearPendingProjectMemoryTransaction(projectRoot)
  } catch {
    // The committed journal is itself crash-recovery metadata. Leaving it in
    // place is safe: the next Project Memory operation preserves participant
    // state and retries cleanup rather than turning a completed write into a
    // false failure after its durable commit point.
  }
}

/** Reads a topic memory file under the 256 KiB cap without auto-creation. */
export async function readTopicMemory(
  projectRoot: string,
  topic: string,
  signal?: AbortSignal,
): Promise<ReadTopicMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir

  const dshExists = await validateCanonicalDirectory(dshDir, signal)
  if (!dshExists) return { exists: false, content: null, path: topicPath, topic }
  const memoryDirExists = await validateCanonicalDirectory(memoryDir, signal)
  if (!memoryDirExists) return { exists: false, content: null, path: topicPath, topic }

  const snapshot = await readTopicSnapshotLocked(memoryDir, topicPath, topic, signal)
  return {
    exists: snapshot.exists,
    content: snapshot.content?.toString('utf8') ?? null,
    path: topicPath,
    topic,
  }
}

/** Whole-file topic write under the topic writer lock, without a Memory-map mutation. */
export async function writeTopicMemory(
  projectRoot: string,
  topic: string,
  content: string,
  signal?: AbortSignal,
): Promise<WriteTopicMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const contentBuffer = topicContentBuffer(content)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(memoryDir, signal)

  return withSafeFileWriterLock(memoryDir, topicPath, async () => {
    const snapshot = await readTopicSnapshotLocked(memoryDir, topicPath, topic, signal)
    return writeTopicMemoryLocked(memoryDir, topicPath, topic, contentBuffer, snapshot, signal)
  }, signal)
}

/** Exact topic edit under the topic writer lock, without a Memory-map mutation. */
export async function editTopicMemory(
  projectRoot: string,
  topic: string,
  oldText: string,
  newText: string,
  signal?: AbortSignal,
): Promise<EditTopicMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  if (typeof oldText !== 'string' || oldText.length === 0) throw new Error('oldText must be a non-empty string')
  if (typeof newText !== 'string') throw new Error('newText must be a string')
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  if (!(await validateCanonicalDirectory(dshDir, signal))) {
    throw new Error(`Cannot edit topic memory: directory "${dshDir}" does not exist`)
  }
  if (!(await validateCanonicalDirectory(memoryDir, signal))) {
    throw new Error(`Cannot edit topic memory: directory "${memoryDir}" does not exist`)
  }

  return withSafeFileWriterLock(memoryDir, topicPath, async () => {
    const snapshot = await readTopicSnapshotLocked(memoryDir, topicPath, topic, signal)
    return editTopicMemoryLocked(memoryDir, topicPath, topic, oldText, newText, snapshot, signal)
  }, signal)
}

/**
 * Whole-file named-topic write plus Memory-map update as a journaled compound
 * transaction. `pending` is rollback state; after both participant commits the
 * journal is atomically changed to `committed` before either writer lock is
 * released. Cleanup after lock release is best-effort and recoverable.
 */
export async function writeTopicMemoryWithMap(
  projectRoot: string,
  topic: string,
  content: string,
  signal?: AbortSignal,
): Promise<WriteTopicMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const contentBuffer = topicContentBuffer(content)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(memoryDir, signal)
  await ensureCanonicalDirectory(paths.localDir, signal)

  let committedJournal: PendingProjectMemoryTransaction | undefined
  const result = await withMemoryMapEntryTransaction(projectRoot, topic, async (commitMap) => {
    return withSafeFileWriterLock(memoryDir, topicPath, async () => {
      signal?.throwIfAborted()
      const topicSnapshot = await readTopicSnapshotLocked(memoryDir, topicPath, topic, signal)
      const memoryBefore = await readSafeRegularFile(memoryDir, paths.memoryMd, { signal })
      const journal = await createPendingProjectMemoryTransaction(projectRoot, {
        topic,
        topicBefore: topicSnapshot.content,
        memoryBefore,
      }, signal)
      try {
        const writeResult = await writeTopicMemoryLocked(
          memoryDir,
          topicPath,
          topic,
          contentBuffer,
          topicSnapshot,
          signal,
        )
        signal?.throwIfAborted()
        await commitMap()
        signal?.throwIfAborted()
        committedJournal = await markProjectMemoryTransactionCommitted(projectRoot, journal, signal)
        return writeResult
      } catch (error) {
        await rollbackJournaledTransaction(projectRoot, topic, journal, error)
      }
    }, signal)
  }, signal)

  if (committedJournal !== undefined) await clearCommittedJournalBestEffort(projectRoot)
  return result
}

/** Exact named-topic edit under the same journaled compound transaction contract. */
export async function editTopicMemoryWithMap(
  projectRoot: string,
  topic: string,
  oldText: string,
  newText: string,
  signal?: AbortSignal,
): Promise<EditTopicMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  if (typeof oldText !== 'string' || oldText.length === 0) throw new Error('oldText must be a non-empty string')
  if (typeof newText !== 'string') throw new Error('newText must be a string')
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  if (!(await validateCanonicalDirectory(dshDir, signal))) {
    throw new Error(`Cannot edit topic memory: directory "${dshDir}" does not exist`)
  }
  if (!(await validateCanonicalDirectory(memoryDir, signal))) {
    throw new Error(`Cannot edit topic memory: directory "${memoryDir}" does not exist`)
  }
  await ensureCanonicalDirectory(paths.localDir, signal)

  let committedJournal: PendingProjectMemoryTransaction | undefined
  const result = await withMemoryMapEntryTransaction(projectRoot, topic, async (commitMap) => {
    return withSafeFileWriterLock(memoryDir, topicPath, async () => {
      signal?.throwIfAborted()
      const topicSnapshot = await readTopicSnapshotLocked(memoryDir, topicPath, topic, signal)
      if (!topicSnapshot.exists || topicSnapshot.content === null) {
        throw new Error(`Topic memory file "${topicPath}" does not exist; cannot edit missing topic`)
      }
      const memoryBefore = await readSafeRegularFile(memoryDir, paths.memoryMd, { signal })
      const journal = await createPendingProjectMemoryTransaction(projectRoot, {
        topic,
        topicBefore: topicSnapshot.content,
        memoryBefore,
      }, signal)
      try {
        const editResult = await editTopicMemoryLocked(
          memoryDir,
          topicPath,
          topic,
          oldText,
          newText,
          topicSnapshot,
          signal,
        )
        signal?.throwIfAborted()
        await commitMap()
        signal?.throwIfAborted()
        committedJournal = await markProjectMemoryTransactionCommitted(projectRoot, journal, signal)
        return editResult
      } catch (error) {
        await rollbackJournaledTransaction(projectRoot, topic, journal, error)
      }
    }, signal)
  }, signal)

  if (committedJournal !== undefined) await clearCommittedJournalBestEffort(projectRoot)
  return result
}
