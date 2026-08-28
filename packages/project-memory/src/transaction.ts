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
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  const buffer = await readSafeRegularFile(paths.localDir, journalPath, {
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
  const content = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_PENDING_TRANSACTION_BYTES) {
    throw new Error('Project memory recovery journal exceeds its maximum size')
  }

  const created = await writeFileExclusiveAtomic(
    paths.localDir,
    pendingProjectMemoryTransactionPath(projectRoot),
    content,
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

async function removeDeadOwnedLock(
  dirPath: string,
  targetFilePath: string,
  ownerPid: number,
): Promise<void> {
  const lockPath = `${targetFilePath}.lock`
  const lock = await readSafeRegularFile(dirPath, lockPath, { maxBytes: 64 })
  if (lock === null) return
  const parsed = Number(lock.toString('utf8').trim())
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Project memory recovery found an invalid writer lock at "${lockPath}"`)
  }
  if (parsed !== ownerPid) {
    throw new Error(`Project memory recovery found a writer lock owned by another process at "${lockPath}"`)
  }
  await removeSafeRegularFile(dirPath, lockPath)
}

/**
 * Restore a compound topic/map transaction whose process died before journal
 * removal. The journal is the commit marker: while it exists, both participant
 * files are restored to their exact pre-transaction bytes. Locks are removed
 * only when they belong to the dead journal owner; a live owner is never
 * interrupted by recovery.
 */
export async function recoverPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const initial = await readPendingTransaction(projectRoot, signal)
  if (initial === null) return false
  if (pidIsAlive(initial.ownerPid)) {
    throw new Error('Project memory transaction recovery refused to interrupt a live transaction owner')
  }

  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  await ensureCanonicalDirectory(dshDir, signal)
  await ensureCanonicalDirectory(paths.memoryDir, signal)
  await ensureCanonicalDirectory(paths.localDir, signal)
  const topicPath = join(paths.memoryDir, `${initial.topic}.md`)

  // A dead process can leave DSH-compatible lock files behind. Remove only the
  // locks whose owner PID matches the journal owner; any other lock means a
  // different process has already taken responsibility and recovery fails closed.
  await removeDeadOwnedLock(paths.memoryDir, paths.memoryMd, initial.ownerPid)
  await removeDeadOwnedLock(paths.memoryDir, topicPath, initial.ownerPid)

  return withSafeFileWriterLock(paths.memoryDir, paths.memoryMd, async () => {
    const current = await readPendingTransaction(projectRoot, signal)
    if (current === null) return false
    if (current.ownerPid !== initial.ownerPid || current.topic !== initial.topic) {
      throw new Error('Project memory recovery journal changed while recovery was starting')
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
