import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CanonicalRegularFileReplacedError,
  removeSafeRegularFile,
  withSafeDirectoryScope,
  withSafeFileWriterLock,
} from '../src/filesystem.js'

test('concurrent safe removals converge without surfacing ENOENT races', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-remove-race-'))
  const target = join(projectRoot, 'cleanup.txt')
  try {
    await writeFile(target, 'cleanup\n', 'utf8')

    const results = await Promise.all(
      Array.from({ length: 32 }, () => removeSafeRegularFile(projectRoot, target)),
    )

    // The public guarantee is idempotent convergence, not unique-winner
    // reporting. Several callers may have validated the same regular file
    // before one unlink becomes visible to the others.
    assert.ok(results.some(Boolean))
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

test('child directory scope never follows a swapped canonical parent symlink', async (t) => {
  if (process.platform === 'win32') {
    t.skip('descriptor-anchored directory operations are a POSIX guarantee')
    return
  }

  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-chain-swap-'))
  const outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-chain-outside-'))
  const dshDir = join(projectRoot, '.dsh')
  const movedDshDir = join(projectRoot, '.dsh-original')
  const memoryDir = join(dshDir, 'memory')
  const logicalTarget = join(memoryDir, 'MEMORY.md')
  const outsideMemoryDir = join(outsideRoot, 'memory')
  const outsideTarget = join(outsideMemoryDir, 'MEMORY.md')
  try {
    await mkdir(memoryDir, { recursive: true })
    await writeFile(logicalTarget, 'inside-before\n', 'utf8')
    await mkdir(outsideMemoryDir)
    await writeFile(outsideTarget, 'outside-sentinel\n', 'utf8')

    await assert.rejects(
      withSafeDirectoryScope(projectRoot, async (rootScope) => {
        const dshResult = await rootScope.withExistingChildDirectory(dshDir, async (dshScope) => {
          await rename(dshDir, movedDshDir)
          await symlink(outsideRoot, dshDir, 'dir')

          const memoryResult = await dshScope.withExistingChildDirectory(memoryDir, async (memoryScope) => {
            await memoryScope.writeFileAtomically(logicalTarget, Buffer.from('inside-after\n', 'utf8'))
            return true
          })
          assert.equal(memoryResult, true)
          return true
        })
        assert.equal(dshResult, true)
      }),
      /changed during the filesystem operation|symbolic link|real directory/,
    )

    assert.equal(await readFile(outsideTarget, 'utf8'), 'outside-sentinel\n')
    assert.equal(await readFile(join(movedDshDir, 'memory', 'MEMORY.md'), 'utf8'), 'inside-after\n')
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
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

test('readRegularFile throws a distinguishable error when the target is atomically replaced by another regular file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('descriptor-anchored open/lstat identity racing is a POSIX guarantee')
    return
  }

  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-read-regular-swap-'))
  const target = join(projectRoot, 'journal.json')
  try {
    await writeFile(target, 'before\n', 'utf8')

    await assert.rejects(
      withSafeDirectoryScope(projectRoot, (scope) => scope.readRegularFile(target, {
        // Deterministically land the replacement inside the exact race
        // window this hook exists for, instead of relying on real timing.
        testOnlyAfterDescriptorStatHook: async () => {
          const scratch = `${target}.swap`
          await writeFile(scratch, 'before\n', 'utf8')
          await rename(scratch, target)
        },
      })),
      (error: unknown) => {
        assert.ok(error instanceof CanonicalRegularFileReplacedError)
        assert.equal(error.code, 'CANONICAL_REGULAR_FILE_REPLACED')
        assert.match(error.message, /was replaced by a different regular file while it was being opened/)
        return true
      },
    )
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('readRegularFile still fails closed with the original message when the target is replaced by a symlink', async (t) => {
  if (process.platform === 'win32') {
    t.skip('descriptor-anchored open/lstat identity racing is a POSIX guarantee')
    return
  }

  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-read-symlink-swap-'))
  const target = join(projectRoot, 'journal.json')
  const decoyTarget = join(projectRoot, 'decoy.json')
  try {
    await writeFile(target, 'before\n', 'utf8')
    await writeFile(decoyTarget, 'decoy\n', 'utf8')

    await assert.rejects(
      withSafeDirectoryScope(projectRoot, (scope) => scope.readRegularFile(target, {
        testOnlyAfterDescriptorStatHook: async () => {
          await rm(target)
          await symlink(decoyTarget, target)
        },
      })),
      (error: unknown) => {
        assert.ok(!(error instanceof CanonicalRegularFileReplacedError))
        assert.match((error as Error).message, /^Canonical target at ".*" changed while it was being opened$/)
        return true
      },
    )
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('readRegularFile still fails closed with the original message when the target is replaced by a directory', async (t) => {
  if (process.platform === 'win32') {
    t.skip('descriptor-anchored open/lstat identity racing is a POSIX guarantee')
    return
  }

  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-read-dir-swap-'))
  const target = join(projectRoot, 'journal.json')
  try {
    await writeFile(target, 'before\n', 'utf8')

    await assert.rejects(
      withSafeDirectoryScope(projectRoot, (scope) => scope.readRegularFile(target, {
        testOnlyAfterDescriptorStatHook: async () => {
          await rm(target)
          await mkdir(target)
        },
      })),
      (error: unknown) => {
        assert.ok(!(error instanceof CanonicalRegularFileReplacedError))
        assert.match((error as Error).message, /^Canonical target at ".*" changed while it was being opened$/)
        return true
      },
    )
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a lock directory caught mid-release reads as unowned, not as malformed', async () => {
  // Release unlinks the owner marker and only then removes the directory, so a
  // concurrent reader lands on an empty lock directory. Reporting that as
  // malformed killed an unrelated caller's memory operation -- the same shape as
  // the recovery race this suite already covers.
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-lock-window-'))
  try {
    const targetPath = join(projectRoot, 'MEMORY.md')
    await writeFile(targetPath, '# memory\n', 'utf8')
    const lockPath = `${targetPath}.lock`
    await mkdir(lockPath)

    await withSafeDirectoryScope(projectRoot, async (scope) => {
      // Exactly the state release leaves behind between unlink and rmdir.
      assert.equal(await scope.readWriterLockOwner(targetPath), null)
    })

    // A directory holding something other than one well-formed owner marker is
    // still malformed: this fix must not turn a corrupt lock into a silent one.
    await writeFile(join(lockPath, 'not-an-owner.txt'), 'x', 'utf8')
    await withSafeDirectoryScope(projectRoot, async (scope) => {
      await assert.rejects(
        () => scope.readWriterLockOwner(targetPath),
        /Malformed project memory writer lock/,
      )
    })
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a writer lock is still exclusive while another process is mid-release', async () => {
  // The reason reporting "no owner" is safe: exclusion is the marker's atomic
  // link(), not this read. Two writers racing an empty lock directory must still
  // serialise.
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-lock-excl-'))
  try {
    const targetPath = join(projectRoot, 'MEMORY.md')
    await writeFile(targetPath, '# memory\n', 'utf8')
    await mkdir(`${targetPath}.lock`)

    let concurrent = 0
    let peak = 0
    const body = async (): Promise<void> => {
      await withSafeFileWriterLock(projectRoot, targetPath, async () => {
        concurrent += 1
        peak = Math.max(peak, concurrent)
        await new Promise(resolve => setTimeout(resolve, 25))
        concurrent -= 1
      })
    }
    await Promise.all([body(), body(), body()])
    assert.equal(peak, 1, 'the writer lock admitted more than one holder at a time')
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
