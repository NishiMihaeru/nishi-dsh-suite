import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { resolveProjectMemoryPaths } from '../src/index.js'
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

async function waitUntilFileExists(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (true) {
    try {
      await access(path)
      return
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

test('cancelled pre-step stops lazy initialization while it is waiting for a writer lock', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-runtime-cancel-'))
  try {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })
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
          eventAt: () => undefined,
        },
      },
    }, async () => ({
      kind: 'enter',
      messages: [{ id: 'prompt', role: 'user', content: [], source: { kind: 'user' } }],
    }))

    // DSH.md is created before initialization reaches MEMORY.md. Its presence
    // proves the initializer is already inside its filesystem work and, with
    // MEMORY.md.lock held above, is now waiting on the exact lock under test.
    await waitUntilFileExists(paths.dshMd)
    controller.abort(new Error('cancel lazy init'))

    const settledBeforeRelease = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
    ])
    assert.equal(settledBeforeRelease, 'rejected')
    await assert.rejects(() => access(paths.memoryMd), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })

    held.release()
    await held.done
    await assert.rejects(pending)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

/**
 * Minimal stand-in for `@deepseek-ai/dsh-session`'s `Session`, matching the
 * parts the runtime reads: the log is private and reachable ONLY through
 * `eventAt`, and `surface.nodes` carries absolute seqs into it. Non-surface
 * events occupy seqs without entering `nodes`, so the stub keeps them sparse --
 * a dense stub would pass even if the runtime indexed a plain array.
 */
function createFakeSession(cwd: string) {
  const log: Array<{ type: string; data?: unknown }> = []
  const nodes: number[] = []
  return {
    header: { cwd },
    surface: { nodes },
    eventAt(seq: number) {
      return log[seq]
    },
    /** What `dsh-agent-loop` commits for every message a pre-step decision enters. */
    commitStep(messages: readonly any[]) {
      log.push({ type: 'step/start' })
      for (const message of messages) {
        nodes.push(log.length)
        log.push({ type: 'user/message', data: message })
      }
    },
  }
}

function capturePreStep(): { run: (payload: any, claimed: any[]) => Promise<any> } {
  let preStep: ((payload: any, next: () => Promise<any>) => Promise<any>) | undefined
  const ctx = {
    on(event: string, listener: any) {
      if (event === 'agent/pre-step') preStep = listener
      return () => {}
    },
  }
  registerProjectContextRuntime(ctx as any)
  assert.ok(preStep)
  return {
    run: (payload, claimed) =>
      preStep!(payload, async () => ({ kind: 'enter', messages: claimed })),
  }
}

function isContextMessage(message: any): boolean {
  return (
    message?.source?.kind === 'plugin' &&
    message?.source?.plugin === 'project-memory' &&
    message?.source?.form === 'instructions'
  )
}

test('project context is injected once and not repeated while it stays unchanged', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-runtime-dedup-'))
  try {
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    const { run } = capturePreStep()
    const session = createFakeSession(projectRoot)
    const agent = { session }

    const first = await run({ step: 1, agent }, [
      { id: 'prompt', role: 'user', content: [], source: { kind: 'user' } },
    ])
    const injected = first.messages.filter(isContextMessage)
    assert.equal(injected.length, 1, 'first step must carry the project context')
    session.commitStep(first.messages)

    for (const step of [2, 3, 4]) {
      const later = await run({ step, agent }, [])
      assert.deepEqual(
        later.messages.filter(isContextMessage),
        [],
        `step ${step} must not re-inject the unchanged project context`,
      )
      session.commitStep(later.messages)
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('project context is re-injected after its sources change on disk', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-runtime-refresh-'))
  try {
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    const paths = resolveProjectMemoryPaths(projectRoot)
    const { run } = capturePreStep()
    const session = createFakeSession(projectRoot)
    const agent = { session }

    const first = await run({ step: 1, agent }, [
      { id: 'prompt', role: 'user', content: [], source: { kind: 'user' } },
    ])
    assert.equal(first.messages.filter(isContextMessage).length, 1)
    session.commitStep(first.messages)

    await writeFile(paths.memoryMd, '- [Fresh](fresh.md) — written mid-session\n', 'utf8')

    const second = await run({ step: 2, agent }, [])
    const refreshed = second.messages.filter(isContextMessage)
    assert.equal(refreshed.length, 1, 'a changed MEMORY.md must reach the model')
    assert.match(refreshed[0].content[0].text, /written mid-session/)
    session.commitStep(second.messages)

    const third = await run({ step: 3, agent }, [])
    assert.deepEqual(
      third.messages.filter(isContextMessage),
      [],
      'the refreshed context must settle back to a single visible copy',
    )
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
