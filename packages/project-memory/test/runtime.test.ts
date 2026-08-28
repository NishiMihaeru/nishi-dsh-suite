import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { initializeDshProject, resolveProjectMemoryPaths } from '../src/index.js'
import { registerProjectContextRuntime } from '../src/runtime.js'

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

test('cancelled pre-step stops lazy initialization while it is waiting for a writer lock', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-runtime-cancel-'))
  try {
    await initializeDshProject(projectRoot)
    const paths = resolveProjectMemoryPaths(projectRoot)
    const held = await holdWriterLock(paths.memoryMd)

    let preStep: ((payload: any, next: () => Promise<any>) => Promise<any>) | undefined
    const ctx = {
      on(event: string, listener: any) {
        if (event === 'agent/pre-step') preStep = listener
        return () => {}
      },
    }
    registerProjectContextRuntime(ctx as any)
    assert.ok(preStep)

    const controller = new AbortController()
    const pending = preStep!({
      step: 1,
      signal: controller.signal,
      agent: {
        session: {
          header: { cwd: projectRoot },
          surface: { nodes: [] },
          events: [],
        },
      },
    }, async () => ({
      kind: 'enter',
      messages: [{ id: 'prompt', role: 'user', content: [], source: { kind: 'user' } }],
    }))

    controller.abort(new Error('cancel lazy init'))
    const settledBeforeRelease = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
    ])
    assert.equal(settledBeforeRelease, 'rejected')

    held.release()
    await held.done
    await assert.rejects(pending)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
