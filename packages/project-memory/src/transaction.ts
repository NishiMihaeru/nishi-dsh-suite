import { join } from 'node:path'
import {
  ensureCanonicalDirectory,
  readSafeRegularFile,
  removeSafeRegularFile,
  validateCanonicalDirectory,
  withSafeDirectoryScope,
  withSafeFileWriterLock,
  writeFileExclusiveAtomic,
  writeSafeFileAtomically,
  type SafeDirectoryScope,
} from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { isValidTopicIdentifier } from './topic-id.js'

export const PENDING_TRANSACTION_VERSION = 1
const PENDING_TRANSACTION_FILENAME = 'project-memory-transaction.json'
const MAX_PENDING_TRANSACTION_BYTES = 1024 * 1024

export type ProjectMemoryTransactionPhase = 'pending' | 'committed'

export interface TransactionFileSnapshot {
  readonly exists: boolean
  readonly contentBase64?: string
}

export interface PendingProjectMemoryTransaction {
  readonly version: typeof PENDING_TRANSACTION_VERSION
  readonly phase: ProjectMemoryTransactionPhase
  readonly ownerPid: number
  readonly topic: string
  readonly topicBefore: TransactionFileSnapshot
  readonly memoryBefore: TransactionFileSnapshot
}

export interface PendingProjectMemoryTransactionInput {
  readonly topic: string
  readonly topicBefore: Buffer | null
  readonly memoryBefore: Buffer | null
}

function snapshotFromBuffer(content: Buffer | null): TransactionFileSnapshot {
  return content === null
    ? { exists: false }
    : { exists: true, contentBase64: content.toString('base64') }
}

function bufferFromSnapshot(snapshot: TransactionFileSnapshot): Buffer | null {
  if (!snapshot.exists) return null
  if (typeof snapshot.contentBase64 !== 'string') {
    throw new Error('Project memory recovery journal contains an invalid file snapshot')
  }
  return Buffer.from(snapshot.contentBase64, 'base64')
}

function isSnapshot(value: unknown): value is TransactionFileSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.exists === false) {
    return Object.keys(record).every(key => key === 'exists')
  }
  return record.exists === true
    && typeof record.contentBase64 === 'string'
    && Object.keys(record).every(key => key === 'exists' || key === 'contentBase64')
}

function parsePendingTransaction(buffer: Buffer): PendingProjectMemoryTransaction {
  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error('Project memory recovery journal contains malformed JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Project memory recovery journal must be an object')
  }
  const record = parsed as Record<string, unknown>
  if (
    record.version !== PENDING_TRANSACTION_VERSION
    || (record.phase !== 'pending' && record.phase !== 'committed')
    || typeof record.ownerPid !== 'number'
    || !Number.isSafeInteger(record.ownerPid)
    || record.ownerPid <= 0
    || typeof record.topic !== 'string'
    || !isValidTopicIdentifier(record.topic)
    || !isSnapshot(record.topicBefore)
    || !isSnapshot(record.memoryBefore)
  ) {
    throw new Error('Project memory recovery journal is invalid')
  }
  const allowed = new Set(['version', 'phase', 'ownerPid', 'topic', 'topicBefore', 'memoryBefore'])
  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw new Error('Project memory recovery journal contains unknown fields')
  }
  return record as unknown as PendingProjectMemoryTransaction
}

function serializePendingTransaction(record: PendingProjectMemoryTransaction): Buffer {
  const content = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
  if (content.length > MAX_PENDING_TRANSACTION_BYTES) {
    throw new Error('Project memory recovery journal exceeds its maximum size')
  }
  return content
}

export function pendingProjectMemoryTransactionPath(projectRoot: string): string {
  return join(resolveProjectMemoryPaths(projectRoot).localDir, PENDING_TRANSACTION_FILENAME)
}

async function readPendingTransactionFromScope(
  projectRoot: string,
  scope: SafeDirectoryScope,
): Promise<PendingProjectMemoryTransaction | null> {
  const buffer = await scope.readRegularFile(
    pendingProjectMemoryTransactionPath(projectRoot),
    { maxBytes: MAX_PENDING_TRANSACTION_BYTES },
  )
  if (buffer === null) return null
  return parsePendingTransaction(buffer)
}

async function readPendingTransaction(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<PendingProjectMemoryTransaction | null> {
  signal?.throwIfAborted()
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (!(await validateCanonicalDirectory(paths.localDir, signal))) return null
  const buffer = await readSafeRegularFile(paths.localDir, pendingProjectMemoryTransactionPath(projectRoot), {
    signal,
    maxBytes: MAX_PENDING_TRANSACTION_BYTES,
  })
  if (buffer === null) return null
  return parsePendingTransaction(buffer)
}

export async function createPendingProjectMemoryTransaction(
  projectRoot: string,
  input: PendingProjectMemoryTransactionInput,
  signal?: AbortSignal,
  journalScope?: SafeDirectoryScope,
): Promise<PendingProjectMemoryTransaction> {
  signal?.throwIfAborted()
  if (!isValidTopicIdentifier(input.topic)) {
    throw new Error(`Invalid topic memory identifier "${input.topic}"`)
  }
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(paths.localDir, signal)

  const record: PendingProjectMemoryTransaction = {
    version: PENDING_TRANSACTION_VERSION,
    phase: 'pending',
    ownerPid: process.pid,
    topic: input.topic,
    topicBefore: snapshotFromBuffer(input.topicBefore),
    memoryBefore: snapshotFromBuffer(input.memoryBefore),
  }
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  const created = journalScope === undefined
    ? await writeFileExclusiveAtomic(
        paths.localDir,
        journalPath,
        serializePendingTransaction(record),
        { mode: 0o600 },
        signal,
      )
    : await journalScope.writeFileExclusiveAtomic(
        journalPath,
        serializePendingTransaction(record),
        { mode: 0o600 },
      )
  if (!created) {
    throw new Error('Project memory has an unresolved pending transaction')
  }
  return record
}

export async function markProjectMemoryTransactionCommitted(
  projectRoot: string,
  expected: PendingProjectMemoryTransaction,
  signal?: AbortSignal,
  journalScope?: SafeDirectoryScope,
): Promise<PendingProjectMemoryTransaction> {
  signal?.throwIfAborted()
  if (expected.phase !== 'pending' || expected.ownerPid !== process.pid) {
    throw new Error('Project memory transaction can only commit its own pending journal')
  }
  const paths = resolveProjectMemoryPaths(projectRoot)
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  const current = journalScope === undefined
    ? await readPendingTransaction(projectRoot, signal)
    : await readPendingTransactionFromScope(projectRoot, journalScope)
  if (
    current === null
    || current.phase !== 'pending'
    || current.ownerPid !== expected.ownerPid
    || current.topic !== expected.topic
  ) {
    throw new Error('Project memory recovery journal changed before transaction commit')
  }
  signal?.throwIfAborted()
  const committed: PendingProjectMemoryTransaction = { ...current, phase: 'committed' }
  if (journalScope === undefined) {
    await writeSafeFileAtomically(paths.localDir, journalPath, serializePendingTransaction(committed), signal)
  } else {
    await journalScope.writeFileAtomically(journalPath, serializePendingTransaction(committed))
  }
  return committed
}

export async function clearPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
  journalScope?: SafeDirectoryScope,
): Promise<void> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (journalScope !== undefined) {
    await journalScope.removeRegularFile(pendingProjectMemoryTransactionPath(projectRoot))
    return
  }
  if (!(await validateCanonicalDirectory(paths.localDir, signal))) return
  await removeSafeRegularFile(paths.localDir, pendingProjectMemoryTransactionPath(projectRoot), signal)
}

export async function restorePendingProjectMemoryTransactionLocked(
  projectRoot: string,
  record: PendingProjectMemoryTransaction,
  memoryScope?: SafeDirectoryScope,
): Promise<void> {
  if (record.phase !== 'pending') {
    throw new Error('Committed project memory transaction must not be rolled back')
  }
  const paths = resolveProjectMemoryPaths(projectRoot)
  const topicPath = join(paths.memoryDir, `${record.topic}.md`)
  const topicBefore = bufferFromSnapshot(record.topicBefore)
  const memoryBefore = bufferFromSnapshot(record.memoryBefore)

  if (memoryScope === undefined) {
    if (topicBefore === null) await removeSafeRegularFile(paths.memoryDir, topicPath)
    else await writeSafeFileAtomically(paths.memoryDir, topicPath, topicBefore)

    if (memoryBefore === null) await removeSafeRegularFile(paths.memoryDir, paths.memoryMd)
    else await writeSafeFileAtomically(paths.memoryDir, paths.memoryMd, memoryBefore)
    return
  }

  if (topicBefore === null) await memoryScope.removeRegularFile(topicPath)
  else await memoryScope.writeFileAtomically(topicPath, topicBefore)

  if (memoryBefore === null) await memoryScope.removeRegularFile(paths.memoryMd)
  else await memoryScope.writeFileAtomically(paths.memoryMd, memoryBefore)
}

/**
 * Called only while the caller already owns MEMORY.md.lock on `memoryScope`.
 * The same scope is reused for any nested topic rollback, so the transaction
 * barrier and participant restore cannot drift to a replacement memoryDir.
 */
export async function settleCommittedProjectMemoryTransactionUnderMapLock(
  projectRoot: string,
  memoryScope: SafeDirectoryScope,
  signal?: AbortSignal,
): Promise<boolean> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (!(await validateCanonicalDirectory(paths.localDir, signal))) return false

  return withSafeDirectoryScope(paths.localDir, async (journalScope) => {
    const current = await readPendingTransactionFromScope(projectRoot, journalScope)
    if (current === null) return false
    if (current.phase === 'committed') {
      await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope)
      return true
    }

    const topicPath = join(paths.memoryDir, `${current.topic}.md`)
    return memoryScope.withWriterLock(topicPath, async () => {
      signal?.throwIfAborted()
      await restorePendingProjectMemoryTransactionLocked(projectRoot, current, memoryScope)
      signal?.throwIfAborted()
      await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope)
      return true
    })
  }, signal)
}

function pidIsAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    if (error?.code === 'ESRCH') return false
    return true
  }
}

async function lockOwnerPid(dirPath: string, targetFilePath: string): Promise<number | null> {
  const lockPath = `${targetFilePath}.lock`
  const lock = await readSafeRegularFile(dirPath, lockPath, { maxBytes: 64 })
  if (lock === null) return null
  const parsed = Number(lock.toString('utf8').trim())
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Project memory recovery found an invalid writer lock at "${lockPath}"`)
  }
  return parsed
}

async function removeDeadLockIfPresent(dirPath: string, targetFilePath: string): Promise<void> {
  const ownerPid = await lockOwnerPid(dirPath, targetFilePath)
  if (ownerPid === null) return
  if (pidIsAlive(ownerPid)) {
    throw new Error(`Project memory recovery found a writer lock owned by a live process at "${targetFilePath}.lock"`)
  }
  await removeSafeRegularFile(dirPath, `${targetFilePath}.lock`)
}

async function waitForLiveTransactionToFinish(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (!(await validateCanonicalDirectory(paths.memoryDir, signal))) return false
  if (!(await validateCanonicalDirectory(paths.localDir, signal))) return false

  return withSafeFileWriterLock(paths.memoryDir, paths.memoryMd, async (memoryScope) => {
    return withSafeDirectoryScope(paths.localDir, async (journalScope) => {
      const remaining = await readPendingTransactionFromScope(projectRoot, journalScope)
      if (remaining === null) return false
      if (remaining.phase === 'committed') {
        await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope)
        return true
      }

      const topicPath = join(paths.memoryDir, `${remaining.topic}.md`)
      return memoryScope.withWriterLock(topicPath, async () => {
        signal?.throwIfAborted()
        await restorePendingProjectMemoryTransactionLocked(projectRoot, remaining, memoryScope)
        signal?.throwIfAborted()
        await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope)
        return true
      })
    }, signal)
  }, signal)
}

/**
 * Recover a compound topic/map transaction. `pending` journals restore both
 * exact pre-images. `committed` journals preserve both new participant states.
 * Recovery binds journal and memory participants to stable directory scopes so
 * no lock/read/restore step can reopen a replacement parent pathname.
 */
export async function recoverPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const initial = await readPendingTransaction(projectRoot, signal)
  if (initial === null) return false
  if (pidIsAlive(initial.ownerPid)) {
    return waitForLiveTransactionToFinish(projectRoot, signal)
  }

  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(paths.memoryDir, signal)
  await ensureCanonicalDirectory(paths.localDir, signal)
  const topicPath = join(paths.memoryDir, `${initial.topic}.md`)
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)

  await removeDeadLockIfPresent(paths.localDir, journalPath)
  await removeDeadLockIfPresent(paths.memoryDir, paths.memoryMd)
  await removeDeadLockIfPresent(paths.memoryDir, topicPath)

  return withSafeFileWriterLock(paths.localDir, journalPath, async (journalScope) => {
    const current = await readPendingTransactionFromScope(projectRoot, journalScope)
    if (current === null) return false
    if (current.topic !== initial.topic || current.phase !== initial.phase) {
      throw new Error('Project memory recovery journal changed while recovery was starting')
    }
    if (current.ownerPid !== initial.ownerPid) {
      if (pidIsAlive(current.ownerPid)) return waitForLiveTransactionToFinish(projectRoot, signal)
      throw new Error('Project memory recovery journal owner changed unexpectedly')
    }
    if (pidIsAlive(current.ownerPid)) return waitForLiveTransactionToFinish(projectRoot, signal)

    const claimed: PendingProjectMemoryTransaction = { ...current, ownerPid: process.pid }
    await journalScope.writeFileAtomically(journalPath, serializePendingTransaction(claimed))

    return withSafeFileWriterLock(paths.memoryDir, paths.memoryMd, async (memoryScope) => {
      const latest = await readPendingTransactionFromScope(projectRoot, journalScope)
      if (latest === null) return false
      if (
        latest.ownerPid !== process.pid
        || latest.topic !== claimed.topic
        || latest.phase !== claimed.phase
      ) {
        throw new Error('Project memory recovery journal changed after recovery claimed it')
      }

      if (latest.phase === 'committed') {
        await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope)
        return true
      }

      const currentTopicPath = join(paths.memoryDir, `${latest.topic}.md`)
      return memoryScope.withWriterLock(currentTopicPath, async () => {
        signal?.throwIfAborted()
        await restorePendingProjectMemoryTransactionLocked(projectRoot, latest, memoryScope)
        signal?.throwIfAborted()
        await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope)
        return true
      })
    }, signal)
  }, signal)
}
