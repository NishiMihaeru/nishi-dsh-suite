import { join } from 'node:path'
import {
  ensureCanonicalDirectory,
  readSafeRegularFile,
  removeSafeRegularFile,
  validateCanonicalDirectory,
  withSafeFileWriterLock,
  writeFileExclusiveAtomic,
  writeSafeFileAtomically,
} from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { isValidTopicIdentifier } from './topic-id.js'

export const PENDING_TRANSACTION_VERSION = 1
const PENDING_TRANSACTION_FILENAME = 'project-memory-transaction.json'
const MAX_PENDING_TRANSACTION_BYTES = 1024 * 1024

export interface TransactionFileSnapshot {
  readonly exists: boolean
  readonly contentBase64?: string
}

export interface PendingProjectMemoryTransaction {
  readonly version: typeof PENDING_TRANSACTION_VERSION
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
  const allowed = new Set(['version', 'ownerPid', 'topic', 'topicBefore', 'memoryBefore'])
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
): Promise<PendingProjectMemoryTransaction> {
  signal?.throwIfAborted()
  if (!isValidTopicIdentifier(input.topic)) {
    throw new Error(`Invalid topic memory identifier "${input.topic}"`)
  }
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  await ensureCanonicalDirectory(dshDir, signal)
  await ensureCanonicalDirectory(paths.localDir, signal)

  const record: PendingProjectMemoryTransaction = {
    version: PENDING_TRANSACTION_VERSION,
    ownerPid: process.pid,
    topic: input.topic,
    topicBefore: snapshotFromBuffer(input.topicBefore),
    memoryBefore: snapshotFromBuffer(input.memoryBefore),
  }
  const created = await writeFileExclusiveAtomic(
    paths.localDir,
    pendingProjectMemoryTransactionPath(projectRoot),
    serializePendingTransaction(record),
    { mode: 0o600 },
    signal,
  )
  if (!created) {
    throw new Error('Project memory has an unresolved pending transaction')
  }
  return record
}

export async function clearPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<void> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (!(await validateCanonicalDirectory(paths.localDir, signal))) return
  await removeSafeRegularFile(paths.localDir, pendingProjectMemoryTransactionPath(projectRoot), signal)
}

export async function restorePendingProjectMemoryTransactionLocked(
  projectRoot: string,
  record: PendingProjectMemoryTransaction,
): Promise<void> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const topicPath = join(paths.memoryDir, `${record.topic}.md`)
  const topicBefore = bufferFromSnapshot(record.topicBefore)
  const memoryBefore = bufferFromSnapshot(record.memoryBefore)

  if (topicBefore === null) {
    await removeSafeRegularFile(paths.memoryDir, topicPath)
  } else {
    await writeSafeFileAtomically(paths.memoryDir, topicPath, topicBefore)
  }

  if (memoryBefore === null) {
    await removeSafeRegularFile(paths.memoryDir, paths.memoryMd)
  } else {
    await writeSafeFileAtomically(paths.memoryDir, paths.memoryMd, memoryBefore)
  }
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

async function claimRecoveryJournal(
  projectRoot: string,
  expected: PendingProjectMemoryTransaction,
  signal?: AbortSignal,
): Promise<PendingProjectMemoryTransaction | null> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  return withSafeFileWriterLock(paths.localDir, journalPath, async () => {
    const current = await readPendingTransaction(projectRoot, signal)
    if (current === null) return null
    if (current.topic !== expected.topic) {
      throw new Error('Project memory recovery journal changed while recovery was starting')
    }
    if (current.ownerPid !== expected.ownerPid) {
      if (pidIsAlive(current.ownerPid)) return current
      throw new Error('Project memory recovery journal owner changed unexpectedly')
    }
    if (pidIsAlive(current.ownerPid)) return current

    const claimed: PendingProjectMemoryTransaction = { ...current, ownerPid: process.pid }
    await writeSafeFileAtomically(paths.localDir, journalPath, serializePendingTransaction(claimed), signal)
    return claimed
  }, signal)
}

async function waitForLiveTransactionToFinish(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (!(await validateCanonicalDirectory(paths.memoryDir, signal))) return false
  await withSafeFileWriterLock(paths.memoryDir, paths.memoryMd, async () => {}, signal)
  const remaining = await readPendingTransaction(projectRoot, signal)
  if (remaining === null) return false
  if (pidIsAlive(remaining.ownerPid)) {
    throw new Error('Project memory transaction remained live after its writer lock was released')
  }
  return recoverPendingProjectMemoryTransaction(projectRoot, signal)
}

/**
 * Restore a compound topic/map transaction whose process died before journal
 * removal. Journal removal is the commit point: while the journal exists, both
 * participant files are restored to their exact pre-transaction bytes. A live
 * transaction is awaited through the normal MEMORY.md writer lock rather than
 * mistaken for a crash.
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
  await ensureCanonicalDirectory(dshDir, signal)
  await ensureCanonicalDirectory(paths.memoryDir, signal)
  await ensureCanonicalDirectory(paths.localDir, signal)
  const topicPath = join(paths.memoryDir, `${initial.topic}.md`)
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)

  // A process death can strand any of the three protocol locks. PID liveness,
  // not file age, is the authority for recovery; a live owner is never removed.
  await removeDeadLockIfPresent(paths.localDir, journalPath)
  await removeDeadLockIfPresent(paths.memoryDir, paths.memoryMd)
  await removeDeadLockIfPresent(paths.memoryDir, topicPath)

  const claimed = await claimRecoveryJournal(projectRoot, initial, signal)
  if (claimed === null) return false
  if (claimed.ownerPid !== process.pid) {
    if (pidIsAlive(claimed.ownerPid)) return waitForLiveTransactionToFinish(projectRoot, signal)
    throw new Error('Project memory recovery could not claim the pending transaction')
  }

  return withSafeFileWriterLock(paths.memoryDir, paths.memoryMd, async () => {
    const current = await readPendingTransaction(projectRoot, signal)
    if (current === null) return false
    if (current.ownerPid !== process.pid || current.topic !== claimed.topic) {
      throw new Error('Project memory recovery journal changed after recovery claimed it')
    }

    return withSafeFileWriterLock(paths.memoryDir, topicPath, async () => {
      signal?.throwIfAborted()
      await restorePendingProjectMemoryTransactionLocked(projectRoot, current)
      signal?.throwIfAborted()
      await clearPendingProjectMemoryTransaction(projectRoot, signal)
      return true
    }, signal)
  }, signal)
}
