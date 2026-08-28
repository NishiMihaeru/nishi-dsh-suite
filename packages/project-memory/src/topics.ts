import { join } from 'node:path'
import type { SafeDirectoryScope } from './filesystem.js'
import { MAX_BOOTSTRAP_BYTES, withMemoryMapEntryTransaction } from './bootstrap.js'
import { resolveProjectMemoryPaths } from './paths.js'
import {
  withEnsuredProjectMemoryScope,
  withExistingProjectMemoryScope,
} from './storage.js'
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
  scope: SafeDirectoryScope,
  topicPath: string,
  topic: string,
  signal?: AbortSignal,
): Promise<TopicSnapshot> {
  signal?.throwIfAborted()
  try {
    const content = await scope.readRegularFile(topicPath, { maxBytes: MAX_TOPIC_BYTES })
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
  scope: SafeDirectoryScope,
  topicPath: string,
  topic: string,
  contentBuffer: Buffer,
  snapshot: TopicSnapshot,
  signal?: AbortSignal,
): Promise<WriteTopicMemoryResult> {
  signal?.throwIfAborted()
  await scope.writeFileAtomically(topicPath, contentBuffer)
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
  scope: SafeDirectoryScope,
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
  await scope.writeFileAtomically(topicPath, updatedBuffer)
  return { topic, path: topicPath, bytesWritten: updatedBuffer.length }
}

async function rollbackJournaledTransaction(
  projectRoot: string,
  topic: string,
  journal: PendingProjectMemoryTransaction,
  originalError: unknown,
  memoryScope: SafeDirectoryScope,
  journalScope: SafeDirectoryScope,
): Promise<never> {
  try {
    const settlementMemoryScope = memoryScope.forSettlement()
    const settlementJournalScope = journalScope.forSettlement()
    await restorePendingProjectMemoryTransactionLocked(projectRoot, journal, settlementMemoryScope)
    await clearPendingProjectMemoryTransaction(
      projectRoot,
      undefined,
      settlementJournalScope,
      journal,
    )
  } catch (rollbackError) {
    throw new AggregateError(
      [originalError, rollbackError],
      `Project memory transaction for topic "${topic}" failed and rollback did not complete cleanly`,
      { cause: originalError },
    )
  }
  throw originalError
}

async function clearCommittedJournalBestEffort(
  projectRoot: string,
  committed: PendingProjectMemoryTransaction,
  journalScope: SafeDirectoryScope,
): Promise<void> {
  try {
    await clearPendingProjectMemoryTransaction(
      projectRoot,
      undefined,
      journalScope.forSettlement(),
      committed,
    )
  } catch {
    // Participants are already committed. Preserve the journal if cleanup
    // cannot complete; recovery can safely retry. Crucially, this runs while
    // MEMORY.md/topic locks are still held, before another generation can be
    // created at the fixed journal pathname.
  }
}

export async function readTopicMemory(
  projectRoot: string,
  topic: string,
  signal?: AbortSignal,
): Promise<ReadTopicMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const topicPath = resolveTopicMemoryPath(projectRoot, topic)
  const result = await withExistingProjectMemoryScope(
    projectRoot,
    (memoryScope) => readTopicSnapshotLocked(memoryScope, topicPath, topic, signal),
    signal,
  )
  if (result === undefined) return { exists: false, content: null, path: topicPath, topic }
  return {
    exists: result.exists,
    content: result.content?.toString('utf8') ?? null,
    path: topicPath,
    topic,
  }
}

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

  return withEnsuredProjectMemoryScope(projectRoot, (memoryScope) => {
    return memoryScope.withWriterLock(topicPath, async (scope) => {
      const snapshot = await readTopicSnapshotLocked(scope, topicPath, topic, signal)
      return writeTopicMemoryLocked(scope, topicPath, topic, contentBuffer, snapshot, signal)
    })
  }, signal)
}

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

  const result = await withExistingProjectMemoryScope(projectRoot, (memoryScope) => {
    return memoryScope.withWriterLock(topicPath, async (scope) => {
      const snapshot = await readTopicSnapshotLocked(scope, topicPath, topic, signal)
      return editTopicMemoryLocked(scope, topicPath, topic, oldText, newText, snapshot, signal)
    })
  }, signal)
  if (result === undefined) {
    throw new Error(`Cannot edit topic memory: directory "${resolveProjectMemoryPaths(projectRoot).memoryDir}" does not exist`)
  }
  return result
}

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

  return withMemoryMapEntryTransaction(
    projectRoot,
    topic,
    async (commitMap, memoryScope, journalScope) => {
      return memoryScope.withWriterLock(topicPath, async () => {
        signal?.throwIfAborted()
        const topicSnapshot = await readTopicSnapshotLocked(memoryScope, topicPath, topic, signal)
        const memoryBefore = await memoryScope.readRegularFile(
          paths.memoryMd,
          { maxBytes: MAX_BOOTSTRAP_BYTES },
        )
        const journal = await createPendingProjectMemoryTransaction(projectRoot, {
          topic,
          topicBefore: topicSnapshot.content,
          memoryBefore,
        }, signal, journalScope)

        let writeResult: WriteTopicMemoryResult
        let committedJournal: PendingProjectMemoryTransaction
        try {
          writeResult = await writeTopicMemoryLocked(
            memoryScope,
            topicPath,
            topic,
            contentBuffer,
            topicSnapshot,
            signal,
          )
          signal?.throwIfAborted()
          await commitMap()
          signal?.throwIfAborted()
          committedJournal = await markProjectMemoryTransactionCommitted(
            projectRoot,
            journal,
            signal,
            journalScope,
          )
        } catch (error) {
          return rollbackJournaledTransaction(
            projectRoot,
            topic,
            journal,
            error,
            memoryScope,
            journalScope,
          )
        }

        // Cleanup is post-commit and therefore must never enter rollback. It
        // stays inside MEMORY.md + topic locks so a later transaction cannot
        // replace the fixed journal pathname before this generation settles.
        await clearCommittedJournalBestEffort(projectRoot, committedJournal, journalScope)
        return writeResult
      })
    },
    signal,
  )
}

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

  return withMemoryMapEntryTransaction(
    projectRoot,
    topic,
    async (commitMap, memoryScope, journalScope) => {
      return memoryScope.withWriterLock(topicPath, async () => {
        signal?.throwIfAborted()
        const topicSnapshot = await readTopicSnapshotLocked(memoryScope, topicPath, topic, signal)
        if (!topicSnapshot.exists || topicSnapshot.content === null) {
          throw new Error(`Topic memory file "${topicPath}" does not exist; cannot edit missing topic`)
        }
        const memoryBefore = await memoryScope.readRegularFile(
          paths.memoryMd,
          { maxBytes: MAX_BOOTSTRAP_BYTES },
        )
        const journal = await createPendingProjectMemoryTransaction(projectRoot, {
          topic,
          topicBefore: topicSnapshot.content,
          memoryBefore,
        }, signal, journalScope)

        let editResult: EditTopicMemoryResult
        let committedJournal: PendingProjectMemoryTransaction
        try {
          editResult = await editTopicMemoryLocked(
            memoryScope,
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
          committedJournal = await markProjectMemoryTransactionCommitted(
            projectRoot,
            journal,
            signal,
            journalScope,
          )
        } catch (error) {
          return rollbackJournaledTransaction(
            projectRoot,
            topic,
            journal,
            error,
            memoryScope,
            journalScope,
          )
        }

        await clearCommittedJournalBestEffort(projectRoot, committedJournal, journalScope)
        return editResult
      })
    },
    signal,
  )
}
