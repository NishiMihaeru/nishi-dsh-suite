import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
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

test('a pending journal owned by this live process is recoverable once the Memory map lock is free', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-live-pending-'))
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const topicPath = join(paths.memoryDir, 'architecture.md')
    const oldTopic = 'state=old\n'
    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)
    await writeTopicMemory(projectRoot, 'architecture', oldTopic)
    await mkdir(paths.localDir, { recursive: true })

    await writeFile(pendingProjectMemoryTransactionPath(projectRoot), `${JSON.stringify({
      version: PENDING_TRANSACTION_VERSION,
      phase: 'pending',
      ownerPid: process.pid,
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
