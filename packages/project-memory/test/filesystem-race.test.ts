import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { removeSafeRegularFile, withSafeFileWriterLock } from '../src/filesystem.js'

test('concurrent safe removals converge without surfacing ENOENT races', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-remove-race-'))
  const target = join(projectRoot, 'cleanup.txt')
  try {
    await writeFile(target, 'cleanup\n', 'utf8')

    const results = await Promise.all(
      Array.from({ length: 32 }, () => removeSafeRegularFile(projectRoot, target)),
    )

    assert.equal(results.filter(Boolean).length, 1)
    await assert.rejects(() => access(target), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('writer scope never redirects a locked RMW into a replacement parent directory', async (t) => {
  if (process.platform === 'win32') {
    t.skip('descriptor-anchored directory operations are a POSIX guarantee')
    return
  }

  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-parent-swap-'))
  const memoryDir = join(projectRoot, 'memory')
  const movedDir = join(projectRoot, 'memory-original')
  const target = join(memoryDir, 'MEMORY.md')
  try {
    await mkdir(memoryDir)
    await writeFile(target, 'before\n', 'utf8')

    await assert.rejects(
      withSafeFileWriterLock(memoryDir, target, async (scope) => {
        await rename(memoryDir, movedDir)
        await mkdir(memoryDir)
        await scope.writeFileAtomically(target, Buffer.from('after\n', 'utf8'))
      }),
      /changed during the filesystem operation/,
    )

    await assert.rejects(() => access(join(memoryDir, 'MEMORY.md')), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
    assert.equal(await readFile(join(movedDir, 'MEMORY.md'), 'utf8'), 'after\n')
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('mandatory settlement on the same scope can restore a durable participant after caller cancellation', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-settlement-'))
  const target = join(projectRoot, 'participant.md')
  const controller = new AbortController()
  const reason = new Error('cancel after participant commit')
  try {
    await writeFile(target, 'before\n', 'utf8')

    await withSafeFileWriterLock(projectRoot, target, async (scope) => {
      await scope.writeFileAtomically(target, Buffer.from('partially-committed\n', 'utf8'))
      controller.abort(reason)

      await assert.rejects(
        () => scope.writeFileAtomically(target, Buffer.from('must-not-write\n', 'utf8')),
        (error: any) => error === reason,
      )

      const settlement = scope.forSettlement()
      await settlement.writeFileAtomically(target, Buffer.from('before\n', 'utf8'))
    }, controller.signal)

    assert.equal(await readFile(target, 'utf8'), 'before\n')
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
