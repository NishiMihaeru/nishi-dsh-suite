import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { removeSafeRegularFile } from '../src/filesystem.js'

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
