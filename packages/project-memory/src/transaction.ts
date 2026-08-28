import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { SafeDirectoryScope } from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { currentProcessIdentity, processOwnerIsAlive } from './process-identity.js'
import {
  withEnsuredProjectLocalScope,
  withEnsuredProjectMemoryScope,
  withEnsuredProjectStorageScopes,
  withExistingProjectLocalScope,
} from './storage.js'
import { isValidTopicIdentifier } from './topic-id.js'

export const PENDING_TRANSACTION_VERSION = 1
const PENDING_TRANSACTION_FILENAME = 'project-memory-transaction.json'
const MAX_PENDING_TRANSACTION_BYTES = 1024 * 1024
const MAX_OWNER_IDENTITY_LENGTH = 512
const MAX_TRANSACTION_ID_LENGTH = 256

export type ProjectMemoryTransactionPhase = 'pending' | 'committed'

export interface TransactionFileSnapshot {
  readonly exists: boolean
  readonly contentBase64?: string
}

export interface PendingProjectMemoryTransaction {
  readonly version: typeof PENDING_TRANSACTION_VERSION
  readonly phase: ProjectMemoryTransactionPhase
  readonly ownerPid: number
  /** Optional for compatibility with journals written before generation-safe ownership. */
  readonly ownerIdentity?: string
  /** Optional for compatibility; every journal created by this build carries one. */
  readonly transactionId?: string
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

function optionalBoundedString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= maxLength)
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
    || !optionalBoundedString(record.ownerIdentity, MAX_OWNER_IDENTITY_LENGTH)
    || !optionalBoundedString(record.transactionId, MAX_TRANSACTION_ID_LENGTH)
    || typeof record.topic !== 'string'
    || !isValidTopicIdentifier(record.topic)
    || !isSnapshot(record.topicBefore)
    || !isSnapshot(record.memoryBefore)
  ) {
    throw new Error('Project memory recovery journal is invalid')
  }
  const allowed = new Set([
    'version',
    'phase',
    'ownerPid',
    'ownerIdentity',
    'transactionId',
    'topic',
    'topicBefore',
    'memoryBefore',
  ])
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

function sameTransactionGeneration(
  left: PendingProjectMemoryTransaction,
  right: PendingProjectMemoryTransaction,
): boolean {
  if (left.transactionId !== undefined || right.transactionId !== undefined) {
    return left.transactionId !== undefined
      && right.transactionId !== undefined
      && left.transactionId === right.transactionId
  }
  // Legacy journals had no generation id. This branch exists only to settle
  // pre-upgrade state; current writers always use transactionId.
  return left.ownerPid === right.ownerPid && left.topic === right.topic
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
  const result = await withExistingProjectLocalScope(
    projectRoot,
    (localScope) => readPendingTransactionFromScope(projectRoot, localScope),
    signal,
  )
  return result ?? null
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

  const ownerIdentity = await currentProcessIdentity()
  const record: PendingProjectMemoryTransaction = {
    version: PENDING_TRANSACTION_VERSION,
    phase: 'pending',
    ownerPid: process.pid,
    ...(ownerIdentity === undefined ? {} : { ownerIdentity }),
    transactionId: randomBytes(16).toString('hex'),
    topic: input.topic,
    topicBefore: snapshotFromBuffer(input.topicBefore),
    memoryBefore: snapshotFromBuffer(input.memoryBefore),
  }
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  const writeRecord = (scope: SafeDirectoryScope) => scope.writeFileExclusiveAtomic(
    journalPath,
    serializePendingTransaction(record),
    { mode: 0o600 },
  )
  const created = journalScope === undefined
    ? await withEnsuredProjectLocalScope(projectRoot, writeRecord, signal)
    : await writeRecord(journalScope)
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
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  const mark = async (scope: SafeDirectoryScope): Promise<PendingProjectMemoryTransaction> => {
    const current = await readPendingTransactionFromScope(projectRoot, scope)
    if (
      current === null
      || current.phase !== 'pending'
      || !sameTransactionGeneration(current, expected)
    ) {
      throw new Error('Project memory recovery journal changed before transaction commit')
    }
    signal?.throwIfAborted()
    const committed: PendingProjectMemoryTransaction = { ...current, phase: 'committed' }
    await scope.writeFileAtomically(
      journalPath,
      serializePendingTransaction(committed),
      { mode: 0o600 },
    )
    return committed
  }

  if (journalScope !== undefined) return mark(journalScope)
  const result = await withExistingProjectLocalScope(projectRoot, mark, signal)
  if (result === undefined) throw new Error('Project memory recovery journal disappeared before transaction commit')
  return result
}

export async function clearPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
  journalScope?: SafeDirectoryScope,
  expected?: PendingProjectMemoryTransaction,
): Promise<void> {
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)
  const clear = async (scope: SafeDirectoryScope): Promise<void> => {
    if (expected !== undefined) {
      const current = await readPendingTransactionFromScope(projectRoot, scope)
      if (
        current === null
        || current.phase !== expected.phase
        || !sameTransactionGeneration(current, expected)
      ) return
    }
    await scope.removeRegularFile(journalPath)
  }

  if (journalScope !== undefined) {
    await clear(journalScope)
    return
  }
  await withExistingProjectLocalScope(projectRoot, clear, signal)
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

  const restore = async (scope: SafeDirectoryScope): Promise<void> => {
    if (topicBefore === null) await scope.removeRegularFile(topicPath)
    else await scope.writeFileAtomically(topicPath, topicBefore)

    if (memoryBefore === null) await scope.removeRegularFile(paths.memoryMd)
    else await scope.writeFileAtomically(paths.memoryMd, memoryBefore)
  }

  if (memoryScope !== undefined) {
    await restore(memoryScope)
    return
  }
  await withEnsuredProjectMemoryScope(projectRoot, restore)
}

export async function settleCommittedProjectMemoryTransactionUnderMapLock(
  projectRoot: string,
  memoryScope: SafeDirectoryScope,
  journalScope: SafeDirectoryScope,
  signal?: AbortSignal,
): Promise<boolean> {
  const current = await readPendingTransactionFromScope(projectRoot, journalScope)
  if (current === null) return false
  if (current.phase === 'committed') {
    await clearPendingProjectMemoryTransaction(projectRoot, signal, journalScope, current)
    return true
  }

  const paths = resolveProjectMemoryPaths(projectRoot)
  const topicPath = join(paths.memoryDir, `${current.topic}.md`)
  return memoryScope.withWriterLock(topicPath, async () => {
    signal?.throwIfAborted()
    const settlementMemory = memoryScope.forSettlement()
    const settlementJournal = journalScope.forSettlement()
    await restorePendingProjectMemoryTransactionLocked(projectRoot, current, settlementMemory)
    await clearPendingProjectMemoryTransaction(projectRoot, undefined, settlementJournal, current)
    return true
  })
}

async function removeDeadLockIfPresent(
  scope: SafeDirectoryScope,
  targetFilePath: string,
): Promise<void> {
  const owner = await scope.readWriterLockOwner(targetFilePath)
  if (owner === null || await processOwnerIsAlive(owner.pid, owner.processIdentity)) return
  await scope.removeWriterLockIfOwnedBy(targetFilePath, owner)
}

async function settlePendingUnderMemoryBarrier(
  projectRoot: string,
  memoryScope: SafeDirectoryScope,
  journalScope: SafeDirectoryScope,
  record: PendingProjectMemoryTransaction,
): Promise<boolean> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  if (record.phase === 'committed') {
    await clearPendingProjectMemoryTransaction(
      projectRoot,
      undefined,
      journalScope.forSettlement(),
      record,
    )
    return true
  }

  const topicPath = join(paths.memoryDir, `${record.topic}.md`)
  return memoryScope.withWriterLock(topicPath, async () => {
    const settlementMemory = memoryScope.forSettlement()
    const settlementJournal = journalScope.forSettlement()
    await restorePendingProjectMemoryTransactionLocked(projectRoot, record, settlementMemory)
    await clearPendingProjectMemoryTransaction(projectRoot, undefined, settlementJournal, record)
    return true
  })
}

async function waitForLiveTransactionToFinish(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  return withEnsuredProjectStorageScopes(projectRoot, ({ memory, local }) => {
    return memory.withWriterLock(paths.memoryMd, async (memoryScope) => {
      const remaining = await readPendingTransactionFromScope(projectRoot, local)
      if (remaining === null) return false
      return settlePendingUnderMemoryBarrier(projectRoot, memoryScope, local, remaining)
    })
  }, signal)
}

/**
 * Recover a compound topic/map transaction. All package-owned descendants are
 * opened through one pinned projectRoot -> .dsh descriptor chain. A dead owner
 * is claimed under the journal lock, then participant state is settled under
 * the normal MEMORY.md -> topic lock order. A live owner is first crossed via
 * the MEMORY.md lock barrier; pending state that still exists after that barrier
 * is abandoned and is rolled back even if the old process itself remains live.
 */
export async function recoverPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const initial = await readPendingTransaction(projectRoot, signal)
  if (initial === null) return false
  if (await processOwnerIsAlive(initial.ownerPid, initial.ownerIdentity)) {
    return waitForLiveTransactionToFinish(projectRoot, signal)
  }

  const paths = resolveProjectMemoryPaths(projectRoot)
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)

  return withEnsuredProjectStorageScopes(projectRoot, async ({ memory, local }) => {
    const initialTopicPath = join(paths.memoryDir, `${initial.topic}.md`)
    await removeDeadLockIfPresent(local, journalPath)
    await removeDeadLockIfPresent(memory, paths.memoryMd)
    await removeDeadLockIfPresent(memory, initialTopicPath)

    return local.withWriterLock(journalPath, async (journalScope) => {
      const current = await readPendingTransactionFromScope(projectRoot, journalScope)
      if (current === null) {
        throw new Error('Project memory recovery journal disappeared before recovery claim')
      }
      if (!sameTransactionGeneration(current, initial) || current.phase !== initial.phase) {
        throw new Error('Project memory recovery journal changed while recovery was starting')
      }
      if (await processOwnerIsAlive(current.ownerPid, current.ownerIdentity)) {
        if (current.ownerPid !== initial.ownerPid || current.ownerIdentity !== initial.ownerIdentity) {
          throw new Error('Project memory recovery journal owner changed to a live process before claim')
        }
        throw new Error('Project memory recovery journal owner became live before claim')
      }

      const ownerIdentity = await currentProcessIdentity()
      const claimed: PendingProjectMemoryTransaction = {
        ...current,
        ownerPid: process.pid,
        ...(ownerIdentity === undefined ? { ownerIdentity: undefined } : { ownerIdentity }),
      }
      await journalScope.writeFileAtomically(
        journalPath,
        serializePendingTransaction(claimed),
        { mode: 0o600 },
      )

      return memory.withWriterLock(paths.memoryMd, async (memoryScope) => {
        const latest = await readPendingTransactionFromScope(projectRoot, journalScope)
        if (latest === null) {
          throw new Error('Project memory recovery journal disappeared after recovery claim')
        }
        if (
          latest.ownerPid !== process.pid
          || !sameTransactionGeneration(latest, claimed)
          || latest.phase !== claimed.phase
        ) {
          throw new Error('Project memory recovery journal changed after recovery claimed it')
        }
        return settlePendingUnderMemoryBarrier(projectRoot, memoryScope, journalScope, latest)
      })
    })
  }, signal)
}
