import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  resolveProjectMemoryPaths,
  writeProjectMemoryBootstrap,
  writeTopicMemory,
} from '../src/index.js'
import { withSafeDirectoryScope, withSafeFileWriterLock } from '../src/filesystem.js'
import {
  PENDING_TRANSACTION_VERSION,
  clearPendingProjectMemoryTransaction,
  createPendingProjectMemoryTransaction,
  markProjectMemoryTransactionCommitted,
  pendingProjectMemoryTransactionPath,
  recoverPendingProjectMemoryTransaction,
} from '../src/transaction.js'

async function withTempProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-audit-regression-'))
  try {
    await fn(projectRoot)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
}

const BASE_MEMORY = '# Project Memory\n\n## Current state\nstable\n\n## Memory map\nNo topic memories yet.\n'

test('delayed cleanup for a committed journal cannot delete the next transaction generation', async () => {
  await withTempProject(async (projectRoot) => {
    const first = await createPendingProjectMemoryTransaction(projectRoot, {
      topic: 'architecture',
      topicBefore: null,
      memoryBefore: null,
    })
    const committed = await markProjectMemoryTransactionCommitted(projectRoot, first)

    // Simulate the next operation/recovery clearing A before it creates B.
    await clearPendingProjectMemoryTransaction(projectRoot)
    await createPendingProjectMemoryTransaction(projectRoot, {
      topic: 'workflow',
      topicBefore: null,
      memoryBefore: null,
    })

    // This is A's delayed best-effort cleanup. The fourth argument is the
    // generation A believes it is clearing; old implementations ignored it.
    await (clearPendingProjectMemoryTransaction as any)(projectRoot, undefined, undefined, committed)

    const raw = JSON.parse(await readFile(pendingProjectMemoryTransactionPath(projectRoot), 'utf8'))
    assert.equal(raw.topic, 'workflow')
    assert.equal(raw.phase, 'pending')
  })
})

test('writer-lock release never removes a replacement lock it does not own', async () => {
  await withTempProject(async (projectRoot) => {
    const targetPath = join(projectRoot, 'MEMORY.md')
    const lockPath = `${targetPath}.lock`

    await withSafeFileWriterLock(projectRoot, targetPath, async () => {
      await rm(lockPath, { recursive: true, force: true })
      await writeFile(lockPath, 'replacement-owner\n', 'utf8')
    })

    assert.equal(await readFile(lockPath, 'utf8'), 'replacement-owner\n')
  })
})

test('safe regular-file reads can cap ingestion to a prefix without materializing the whole file', async () => {
  await withTempProject(async (projectRoot) => {
    const targetPath = join(projectRoot, 'large-memory.md')
    await writeFile(targetPath, Buffer.alloc(128 * 1024, 0x61))

    await withSafeDirectoryScope(projectRoot, async (scope) => {
      const prefix = await (scope.readRegularFile as any)(targetPath, { prefixBytes: 64 })
      assert.ok(prefix !== null)
      assert.equal(prefix.length, 64)
      assert.equal(prefix.toString('utf8'), 'a'.repeat(64))
    })
  })
})

test('committed recovery journal keeps owner-only permissions', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not an authoritative Windows permission model')
    return
  }
  await withTempProject(async (projectRoot) => {
    const pending = await createPendingProjectMemoryTransaction(projectRoot, {
      topic: 'architecture',
      topicBefore: null,
      memoryBefore: null,
    })
    await markProjectMemoryTransactionCommitted(projectRoot, pending)

    const mode = (await stat(pendingProjectMemoryTransactionPath(projectRoot))).mode & 0o777
    assert.equal(mode, 0o600)
  })
})

test('recovery does not confuse a reused live PID with the dead transaction owner', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const topicPath = join(paths.memoryDir, 'architecture.md')
    const transactionPath = pendingProjectMemoryTransactionPath(projectRoot)
    const beforeTopic = 'state=before\n'

    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)
    await writeTopicMemory(projectRoot, 'architecture', beforeTopic)
    await mkdir(paths.localDir, { recursive: true })

    await writeFile(transactionPath, JSON.stringify({
      version: PENDING_TRANSACTION_VERSION,
      phase: 'pending',
      ownerPid: process.pid,
      ownerIdentity: 'stale-process-identity',
      transactionId: 'stale-transaction-generation',
      topic: 'architecture',
      topicBefore: {
        exists: true,
        contentBase64: Buffer.from(beforeTopic, 'utf8').toString('base64'),
      },
      memoryBefore: {
        exists: true,
        contentBase64: Buffer.from(BASE_MEMORY, 'utf8').toString('base64'),
      },
    }) + '\n', 'utf8')

    await writeFile(topicPath, 'state=partially-committed\n', 'utf8')
    await writeFile(
      paths.memoryMd,
      BASE_MEMORY.replace('No topic memories yet.', '- `architecture` → `.dsh/memory/architecture.md`'),
      'utf8',
    )

    // Simulate a lock left by the dead process whose numeric PID has since
    // been reused by this process. New-format ownership carries process
    // identity, so the PID alone must not keep the stale lock alive.
    const memoryLockDir = `${paths.memoryMd}.lock`
    await mkdir(memoryLockDir)
    await writeFile(join(memoryLockDir, 'owner-stale.json'), JSON.stringify({
      version: 1,
      pid: process.pid,
      processIdentity: 'stale-process-identity',
      token: 'stale-lock-owner',
    }) + '\n', { mode: 0o600 })

    await recoverPendingProjectMemoryTransaction(projectRoot)

    assert.equal(await readFile(topicPath, 'utf8'), beforeTopic)
    assert.equal(await readFile(paths.memoryMd, 'utf8'), BASE_MEMORY)
    await assert.rejects(() => stat(transactionPath), (error: any) => error?.code === 'ENOENT')
    await assert.rejects(() => stat(memoryLockDir), (error: any) => error?.code === 'ENOENT')
  })
})
