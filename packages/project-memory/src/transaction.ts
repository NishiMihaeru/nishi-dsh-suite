import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { CanonicalRegularFileReplacedError, type SafeDirectoryScope } from './filesystem.js'
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

function sameSnapshot(left: TransactionFileSnapshot, right: TransactionFileSnapshot): boolean {
  return left.exists === right.exists && left.contentBase64 === right.contentBase64
}

function sameTransactionOwner(
  left: PendingProjectMemoryTransaction,
  right: PendingProjectMemoryTransaction,
): boolean {
  return left.ownerPid === right.ownerPid && left.ownerIdentity === right.ownerIdentity
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
  // Legacy journals had no generation id and recovery legitimately rewrites
  // their owner fields while claiming them. Use only immutable transaction
  // payload to identify that pre-upgrade generation; owner changes are checked
  // separately and fail closed before claim.
  return left.topic === right.topic
    && sameSnapshot(left.topicBefore, right.topicBefore)
    && sameSnapshot(left.memoryBefore, right.memoryBefore)
}

export function pendingProjectMemoryTransactionPath(projectRoot: string): string {
  return join(resolveProjectMemoryPaths(projectRoot).localDir, PENDING_TRANSACTION_FILENAME)
}

async function readPendingTransactionFromScope(
  projectRoot: string,
  scope: SafeDirectoryScope,
  /** TEST-ONLY seam, forwarded to `readRegularFile`. See `readPendingTransaction`. */
  testOnlyAfterDescriptorStatHook?: () => Promise<void>,
): Promise<PendingProjectMemoryTransaction | null> {
  const buffer = await scope.readRegularFile(
    pendingProjectMemoryTransactionPath(projectRoot),
    { maxBytes: MAX_PENDING_TRANSACTION_BYTES, testOnlyAfterDescriptorStatHook },
  )
  if (buffer === null) return null
  return parsePendingTransaction(buffer)
}

async function readPendingTransaction(
  projectRoot: string,
  signal?: AbortSignal,
  /**
   * TEST-ONLY seam. Only ever wired in from the unlocked pre-claim probe in
   * `recoverPendingProjectMemoryTransaction` -- never from a locked read --
   * so tests can deterministically exercise that probe's benign-replacement
   * re-observe path without relying on real concurrency/timing.
   */
  testOnlyAfterDescriptorStatHook?: () => Promise<void>,
): Promise<PendingProjectMemoryTransaction | null> {
  signal?.throwIfAborted()
  const result = await withExistingProjectLocalScope(
    projectRoot,
    (localScope) => readPendingTransactionFromScope(projectRoot, localScope, testOnlyAfterDescriptorStatHook),
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
      || !sameTransactionOwner(current, expected)
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
        || !sameTransactionOwner(current, expected)
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

// A dead-owner journal observed before the journal lock is acquired can
// legitimately vanish, be replaced by a new generation, or change owner
// (including to a live process) by the time the lock is actually granted:
// another concurrent recovery attempt may have already won the race and
// finished settling it. None of that is loss of proof of ownership -- it is
// simply that our pre-lock observation is stale, and observing again from
// scratch is safe because we have not mutated anything yet. Retrying a bounded
// number of times turns that stale-observation race into a normal outcome
// instead of a spurious failure for whichever caller loses the race.
const RETRY = Symbol('project-memory-transaction-recovery-retry')

// Generous but finite: real contention resolves within a handful of
// observations, and a bound avoids ever looping forever if some invariant
// this reasoning depends on turns out to be violated.
const MAX_RECOVERY_OBSERVATIONS = 5

async function claimAndSettleDeadOwner(
  projectRoot: string,
  initial: PendingProjectMemoryTransaction,
  signal?: AbortSignal,
): Promise<boolean | typeof RETRY> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const journalPath = pendingProjectMemoryTransactionPath(projectRoot)

  return withEnsuredProjectStorageScopes(projectRoot, async ({ memory, local }) => {
    const initialTopicPath = join(paths.memoryDir, `${initial.topic}.md`)
    await removeDeadLockIfPresent(local, journalPath)
    await removeDeadLockIfPresent(memory, paths.memoryMd)
    await removeDeadLockIfPresent(memory, initialTopicPath)

    return local.withWriterLock(journalPath, async (journalScope) => {
      const current = await readPendingTransactionFromScope(projectRoot, journalScope)
      // Benign: the journal is already gone. Someone else settled it (or it
      // never needed settling), so from here recovery has nothing to do.
      if (current === null) return RETRY
      // Benign: a different transaction generation now occupies the fixed
      // journal pathname, or its phase moved on. Our snapshot is stale.
      if (!sameTransactionGeneration(current, initial) || current.phase !== initial.phase) return RETRY
      // Benign: ownership changed before we could claim it, in either
      // direction. We have not touched any participant yet, so this is just a
      // stale observation, not lost proof of ownership -- re-observe from
      // scratch and let the fresh read decide whether the (possibly live) new
      // owner should be awaited or claimed.
      if (!sameTransactionOwner(current, initial)) return RETRY
      // Benign: the original owner (or a claimant that reused its identity)
      // came back to life before we claimed it.
      if (await processOwnerIsAlive(current.ownerPid, current.ownerIdentity)) return RETRY

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
        // From here on we have durably claimed the journal ourselves: any
        // further mismatch is a real loss of proof of ownership (someone else
        // mutated our own claim) and must fail closed rather than retry.
        const latest = await readPendingTransactionFromScope(projectRoot, journalScope)
        if (latest === null) {
          throw new Error('Project memory recovery journal disappeared after recovery claim')
        }
        if (
          !sameTransactionOwner(latest, claimed)
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

/**
 * Recover a compound topic/map transaction. All package-owned descendants are
 * opened through one pinned projectRoot -> .dsh descriptor chain. A dead owner
 * is claimed under the journal lock, then participant state is settled under
 * the normal MEMORY.md -> topic lock order. A live owner is first crossed via
 * the MEMORY.md lock barrier; pending state that still exists after that barrier
 * is abandoned and is rolled back even if the old process itself remains live.
 *
 * Concurrent callers observing the same dead-owner journal race harmlessly:
 * a benign pre-claim outcome (journal gone, generation/phase changed, owner
 * changed, owner came back alive, or the journal pathname was atomically
 * replaced by a different regular file out from under this unlocked probe)
 * re-observes from scratch instead of failing, up to MAX_RECOVERY_OBSERVATIONS
 * times. Replacement by a symlink or other non-regular entry still fails
 * closed, as does any change to the journal after this process has durably
 * claimed it (see `claimAndSettleDeadOwner`). If observations keep
 * churning past that bound, this returns `false` (nothing recovered by us)
 * rather than looping forever. That is safe for callers: any subsequent
 * `createPendingProjectMemoryTransaction` still fails closed via
 * `writeFileExclusiveAtomic` if a pending journal is genuinely still present,
 * so returning `false` here never lets a real unresolved transaction slip
 * through unnoticed.
 */
export async function recoverPendingProjectMemoryTransaction(
  projectRoot: string,
  signal?: AbortSignal,
  /**
   * TEST-ONLY seam threaded down to the unlocked pre-claim journal read
   * below. Lets a test deterministically replace the journal with a
   * different regular file inside the open/lstat race window that read
   * probes without holding a lock. Must never be set by production code.
   */
  testOnlyPreClaimReadHook?: () => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RECOVERY_OBSERVATIONS; attempt++) {
    signal?.throwIfAborted()
    let initial: PendingProjectMemoryTransaction | null
    try {
      // This probe is unlocked: nothing has been claimed yet, so a benign
      // concurrent atomic rewrite of the journal (another regular file
      // replacing this one) is just a stale observation, not lost proof of
      // ownership. Re-observe from scratch rather than failing an unrelated
      // caller's operation. Replacement by a symlink or non-regular entry,
      // and any change to a journal *after* this process has durably
      // claimed it (see `claimAndSettleDeadOwner`), still fail closed.
      initial = await readPendingTransaction(projectRoot, signal, testOnlyPreClaimReadHook)
    } catch (error) {
      if (error instanceof CanonicalRegularFileReplacedError) continue
      throw error
    }
    if (initial === null) return false
    if (await processOwnerIsAlive(initial.ownerPid, initial.ownerIdentity)) {
      return waitForLiveTransactionToFinish(projectRoot, signal)
    }

    const outcome = await claimAndSettleDeadOwner(projectRoot, initial, signal)
    if (outcome !== RETRY) return outcome
  }
  return false
}
