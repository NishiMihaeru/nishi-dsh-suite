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

test('recovery fails closed if a dead-owner journal is transferred to a live owner before claim', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-recovery-owner-race-'))
  const deadPid = 2_000_000_000
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { topicPath } = await installAbandonedPending(projectRoot, deadPid)
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

    await assert.rejects(
      recovery,
      /recovery journal owner changed to a live process before claim/,
    )
    assert.equal(JSON.parse(await readFile(transactionPath, 'utf8')).ownerPid, process.pid)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
