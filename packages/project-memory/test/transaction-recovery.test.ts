import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  ensureMemoryMapEntry,
  readDshProjectContext,
  readProjectMemoryBootstrap,
  readTopicMemory,
  resolveProjectMemoryPaths,
  writeProjectMemoryBootstrap,
  writeTopicMemory,
} from '../src/index.js'
import {
  PENDING_TRANSACTION_VERSION,
  pendingProjectMemoryTransactionPath,
  recoverPendingProjectMemoryTransaction,
} from '../src/transaction.js'

const BASE_MEMORY = '# Project Memory\n\n## Memory map\nNo topic memories yet.\n'

async function installAbandonedPending(
  projectRoot: string,
  ownerPid: number,
): Promise<{ topicPath: string; oldTopic: string }> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const topicPath = join(paths.memoryDir, 'architecture.md')
  const oldTopic = 'state=old\n'
  await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)
  await writeTopicMemory(projectRoot, 'architecture', oldTopic)
  await mkdir(paths.localDir, { recursive: true })

  await writeFile(pendingProjectMemoryTransactionPath(projectRoot), `${JSON.stringify({
    version: PENDING_TRANSACTION_VERSION,
    phase: 'pending',
    ownerPid,
    topic: 'architecture',
    topicBefore: { exists: true, contentBase64: Buffer.from(oldTopic, 'utf8').toString('base64') },
    memoryBefore: { exists: true, contentBase64: Buffer.from(BASE_MEMORY, 'utf8').toString('base64') },
  })}\n`, 'utf8')

  await writeFile(topicPath, 'state=uncommitted\n', 'utf8')
  await writeFile(
    paths.memoryMd,
    BASE_MEMORY.replace('No topic memories yet.', '- `architecture` → `.dsh/memory/architecture.md`'),
    'utf8',
  )
  return { topicPath, oldTopic }
}

async function holdWriterLock(filename: string): Promise<{ release: () => void; done: Promise<void> }> {
  let release!: () => void
  let acquired!: () => void
  const acquiredPromise = new Promise<void>((resolve) => { acquired = resolve })
  const done = withFileLock(filename, async () => {
    acquired()
    await new Promise<void>((resolve) => { release = resolve })
  })
  await acquiredPromise
  return { release, done }
}

async function waitUntilMissing(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(path)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    await sleep(10)
  }
  throw new Error(`Timed out waiting for ${path} to be removed`)
}

async function waitUntilClaimedByThisProcess(transactionPath: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const record = JSON.parse(await readFile(transactionPath, 'utf8'))
      if (record.ownerPid === process.pid) return
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
    await sleep(10)
  }
  throw new Error(`Timed out waiting for ${transactionPath} to be claimed by this process`)
}

test('a pending journal owned by this live process is recoverable once the Memory map lock is free', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-live-pending-'))
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { topicPath, oldTopic } = await installAbandonedPending(projectRoot, process.pid)

    assert.equal(await recoverPendingProjectMemoryTransaction(projectRoot), true)
    assert.equal(await readFile(topicPath, 'utf8'), oldTopic)
    assert.equal(await readFile(paths.memoryMd, 'utf8'), BASE_MEMORY)
    await assert.rejects(() => access(pendingProjectMemoryTransactionPath(projectRoot)), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a new Memory-map transaction settles abandoned pending state after acquiring the map lock', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-map-barrier-'))
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { topicPath, oldTopic } = await installAbandonedPending(projectRoot, process.pid)

    await ensureMemoryMapEntry(projectRoot, 'workflow')

    assert.equal(await readFile(topicPath, 'utf8'), oldTopic)
    const memory = await readFile(paths.memoryMd, 'utf8')
    assert.doesNotMatch(memory, /`architecture`/)
    assert.match(memory, /- `workflow` → `\.dsh\/memory\/workflow\.md`/)
    await assert.rejects(() => access(pendingProjectMemoryTransactionPath(projectRoot)), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('public bootstrap read recovers abandoned pending state before exposing MEMORY.md', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-bootstrap-recovery-'))
  try {
    await installAbandonedPending(projectRoot, process.pid)

    const result = await readProjectMemoryBootstrap(projectRoot)

    assert.equal(result.exists, true)
    assert.equal(result.content, BASE_MEMORY)
    await assert.rejects(() => access(pendingProjectMemoryTransactionPath(projectRoot)), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('public DSH context read recovers abandoned pending state before injecting MEMORY.md', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-context-recovery-'))
  try {
    await installAbandonedPending(projectRoot, process.pid)

    const result = await readDshProjectContext({ projectRoot })

    assert.equal(result.memoryBootstrap.exists, true)
    assert.equal(result.memoryBootstrap.content, BASE_MEMORY)
    await assert.rejects(() => access(pendingProjectMemoryTransactionPath(projectRoot)), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a dead-owner journal transferred to a live owner before claim is a benign stale observation, not a failure', async () => {
  // Before the fix, observing a pre-claim owner change (even to a live
  // process) threw and never re-observed, which meant one caller's stale
  // read could fail an entirely unrelated caller's operation. The owner
  // change here has not touched any participant yet, so it must be treated
  // like any other pre-claim race: re-observe from scratch. On re-observation
  // the transferred owner is us (a live pid), so recovery crosses the
  // MEMORY.md barrier and settles the still-pending state instead of
  // rejecting.
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-recovery-owner-race-'))
  const deadPid = 2_000_000_000
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { topicPath, oldTopic } = await installAbandonedPending(projectRoot, deadPid)
    const transactionPath = pendingProjectMemoryTransactionPath(projectRoot)
    await writeFile(`${paths.memoryMd}.lock`, `${deadPid}\n`, 'utf8')
    await writeFile(`${topicPath}.lock`, `${deadPid}\n`, 'utf8')

    const heldJournal = await holdWriterLock(transactionPath)
    const recovery = recoverPendingProjectMemoryTransaction(projectRoot)

    // These removals happen only after recovery has observed the original dead
    // journal owner and entered the canonical storage scope, but before it can
    // acquire the journal lock held above.
    await waitUntilMissing(`${paths.memoryMd}.lock`)
    await waitUntilMissing(`${topicPath}.lock`)

    const liveRecord = JSON.parse(await readFile(transactionPath, 'utf8'))
    liveRecord.ownerPid = process.pid
    await writeFile(transactionPath, `${JSON.stringify(liveRecord)}\n`, 'utf8')
    heldJournal.release()
    await heldJournal.done

    assert.equal(await recovery, true)
    assert.equal(await readFile(topicPath, 'utf8'), oldTopic)
    assert.equal(await readFile(paths.memoryMd, 'utf8'), BASE_MEMORY)
    await assert.rejects(() => access(transactionPath), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('two concurrent recoveries of the same dead pending journal both resolve, and pre-images are restored exactly once', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-recovery-concurrent-'))
  const deadPid = 2_000_000_001
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { topicPath, oldTopic } = await installAbandonedPending(projectRoot, deadPid)
    const transactionPath = pendingProjectMemoryTransactionPath(projectRoot)

    const results = await Promise.allSettled([
      recoverPendingProjectMemoryTransaction(projectRoot),
      recoverPendingProjectMemoryTransaction(projectRoot),
    ])

    for (const result of results) {
      assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined)
    }
    const values = results.map((result) => (result as PromiseFulfilledResult<boolean>).value).sort()
    // Exactly one caller does the actual recovery work (`true`); the other
    // observes the journal already gone on its own turn at the lock and
    // reports `false` without throwing.
    assert.deepEqual(values, [false, true])

    assert.equal(await readFile(topicPath, 'utf8'), oldTopic)
    assert.equal(await readFile(paths.memoryMd, 'utf8'), BASE_MEMORY)
    await assert.rejects(() => access(transactionPath), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('concurrent readTopicMemory of unrelated topics both resolve while a dead pending journal is recovered', async () => {
  // This is the originally reported defect: an unrelated topic read must not
  // fail just because it happened to lose a recovery race for someone else's
  // abandoned transaction.
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-recovery-unrelated-topics-'))
  const deadPid = 2_000_000_002
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { topicPath, oldTopic } = await installAbandonedPending(projectRoot, deadPid)

    const results = await Promise.allSettled([
      readTopicMemory(projectRoot, 'architecture'),
      readTopicMemory(projectRoot, 'notes'),
    ])

    for (const result of results) {
      assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined)
    }
    const [architectureResult, notesResult] = results.map(
      (result) => (result as PromiseFulfilledResult<{ exists: boolean; content: string | null }>).value,
    )
    assert.equal(architectureResult!.exists, true)
    assert.equal(architectureResult!.content, oldTopic)
    assert.equal(notesResult!.exists, false)
    assert.equal(notesResult!.content, null)

    assert.equal(await readFile(topicPath, 'utf8'), oldTopic)
    assert.equal(await readFile(paths.memoryMd, 'utf8'), BASE_MEMORY)
    await assert.rejects(() => access(pendingProjectMemoryTransactionPath(projectRoot)), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('recovery still fails closed if the claimed journal disappears after claim, under the MEMORY.md barrier', async () => {
  // Once recovery has durably rewritten the journal to claim it, the journal
  // writer lock stays held by recovery itself, so no cooperating lock holder
  // can touch it. A raw bypass write (no lock acquired at all -- exactly the
  // kind of external mutation these invariants defend against) simulates the
  // journal vanishing at that point. This must remain a hard failure: proof
  // of ownership was already asserted and then lost, unlike the pre-claim
  // cases above where nothing had been asserted yet.
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-recovery-postclaim-disappear-'))
  const deadPid = 2_000_000_003
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await installAbandonedPending(projectRoot, deadPid)
    const transactionPath = pendingProjectMemoryTransactionPath(projectRoot)

    const heldMemory = await holdWriterLock(paths.memoryMd)
    const recovery = recoverPendingProjectMemoryTransaction(projectRoot)

    // Recovery claims the journal (rewriting ownerPid to itself) before it
    // blocks trying to acquire the externally held MEMORY.md lock.
    await waitUntilClaimedByThisProcess(transactionPath)
    await rm(transactionPath)
    heldMemory.release()
    await heldMemory.done

    await assert.rejects(recovery, /recovery journal disappeared after recovery claim/)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('recovery still fails closed if the claimed journal is replaced after claim, under the MEMORY.md barrier', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-recovery-postclaim-replace-'))
  const deadPid = 2_000_000_004
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await installAbandonedPending(projectRoot, deadPid)
    const transactionPath = pendingProjectMemoryTransactionPath(projectRoot)

    const heldMemory = await holdWriterLock(paths.memoryMd)
    const recovery = recoverPendingProjectMemoryTransaction(projectRoot)

    await waitUntilClaimedByThisProcess(transactionPath)
    const claimedRecord = JSON.parse(await readFile(transactionPath, 'utf8'))
    // Flip the phase in place: same generation/owner, but a real post-claim
    // change recovery did not itself make.
    await writeFile(
      transactionPath,
      `${JSON.stringify({ ...claimedRecord, phase: 'committed' })}\n`,
      'utf8',
    )
    heldMemory.release()
    await heldMemory.done

    await assert.rejects(recovery, /recovery journal changed after recovery claimed it/)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
