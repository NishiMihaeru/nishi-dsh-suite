import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { withSafeFileWriterLock } from '../src/filesystem.js'

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

test('an explicit small lockWaitMs times out faster than the default wait budget, against a genuinely held lock', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-lock-wait-config-'))
  const targetFilePath = join(projectRoot, 'target.txt')
  try {
    await writeFile(targetFilePath, 'content\n', 'utf8')

    // A genuinely held lock, not a timing race: the configured attempt below
    // is guaranteed to contend for the whole measured interval.
    const held = await holdWriterLock(targetFilePath)

    const start = Date.now()
    await assert.rejects(
      withSafeFileWriterLock(
        projectRoot,
        targetFilePath,
        async () => {},
        undefined,
        { lockWaitMs: 100 },
      ),
      /atomic-write: timed out waiting for the writer lock/,
    )
    const elapsed = Date.now() - start

    // The configured 100ms budget must actually be honored, and must resolve
    // well before the raised 10s default would have.
    assert.ok(elapsed >= 100, `expected elapsed (${elapsed}ms) >= configured lockWaitMs (100ms)`)
    assert.ok(elapsed < 5_000, `expected elapsed (${elapsed}ms) to be far below the default wait budget`)

    held.release()
    await held.done
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('lockWaitMs rejects a non-positive or non-integer value with a TypeError', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-lock-wait-invalid-'))
  const targetFilePath = join(projectRoot, 'target.txt')
  try {
    await writeFile(targetFilePath, 'content\n', 'utf8')

    for (const invalid of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(
        withSafeFileWriterLock(
          projectRoot,
          targetFilePath,
          async () => {},
          undefined,
          { lockWaitMs: invalid },
        ),
        TypeError,
      )
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
