import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  editTopicMemoryWithMap,
  resolveProjectMemoryPaths,
  writeProjectMemoryBootstrap,
  writeTopicMemory,
  writeTopicMemoryWithMap,
} from '../src/index.js'

const RMW_WORKER = fileURLToPath(new URL('./fixtures/rmw-worker.mjs', import.meta.url))

async function withTempProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-compound-test-'))
  try {
    await fn(projectRoot)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
}

interface Worker {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  done: Promise<void>
  stdout: () => string
  stderr: () => string
}

function spawnWorker(...args: string[]): Worker {
  const child = spawn(process.execPath, ['--import', 'tsx', RMW_WORKER, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let resolveReady!: () => void
  let readyResolved = false
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    if (!readyResolved && stdout.includes('READY\n')) {
      readyResolved = true
      resolveReady()
    }
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(
        `compound worker exited code=${String(code)} signal=${String(signal)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ))
    })
  })
  return { child, ready, done, stdout: () => stdout, stderr: () => stderr }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path)
    assert.fail(`Expected ${path} to be absent`)
  } catch (error: any) {
    assert.equal(error?.code, 'ENOENT')
  }
}

async function holdWriterLock(filename: string): Promise<{ release: () => void; done: Promise<void> }> {
  let release!: () => void
  let acquired!: () => void
  const acquiredPromise = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const done = withFileLock(filename, async () => {
    acquired()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  await acquiredPromise
  return { release, done }
}

const BASE_MEMORY = '# Project Memory\n\n## Current state\nstable\n\n## Memory map\nNo topic memories yet.\n'

test('compound topic write commits topic content and its canonical Memory map entry together', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)

    const result = await writeTopicMemoryWithMap(projectRoot, 'architecture', '# Architecture\ntransactional\n')

    assert.equal(result.created, true)
    assert.equal(await readFile(join(paths.memoryDir, 'architecture.md'), 'utf8'), '# Architecture\ntransactional\n')
    const memory = await readFile(paths.memoryMd, 'utf8')
    assert.match(memory, /- `architecture` → `\.dsh\/memory\/architecture\.md`/)
  })
})

test('invalid Memory map preflight rejects a new topic before topic mutation', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(
      projectRoot,
      '# Project Memory\n\n## Memory map\nNo topic memories yet.\n\n## Memory map\nDuplicate section.\n',
    )
    const topicPath = join(paths.memoryDir, 'architecture.md')

    await assert.rejects(
      () => writeTopicMemoryWithMap(projectRoot, 'architecture', 'must-not-persist\n'),
      /Ambiguous multiple "## Memory map" sections/,
    )
    await assertMissing(topicPath)
  })
})

test('invalid Memory map preflight leaves an existing topic byte-for-byte unchanged on edit', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const original = 'before=old\nkeep=this\n'
    await writeTopicMemory(projectRoot, 'architecture', original)
    await writeProjectMemoryBootstrap(
      projectRoot,
      '# Project Memory\n\n## Memory map\nNo topic memories yet.\n\n## Memory map\nDuplicate section.\n',
    )

    await assert.rejects(
      () => editTopicMemoryWithMap(projectRoot, 'architecture', 'old', 'new'),
      /Ambiguous multiple "## Memory map" sections/,
    )
    assert.equal(await readFile(join(paths.memoryDir, 'architecture.md'), 'utf8'), original)
  })
})

test('failed compound edit does not create a missing MEMORY.md as a preflight side effect', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })

    await assert.rejects(
      () => editTopicMemoryWithMap(projectRoot, 'architecture', 'old', 'new'),
      /does not exist; cannot edit missing topic/,
    )
    await assertMissing(paths.memoryMd)
    await assertMissing(join(paths.memoryDir, 'architecture.md'))
  })
})

test('compound edit repairs a missing map entry while applying the exact topic edit', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)
    await writeTopicMemory(projectRoot, 'architecture', 'state=old\n')

    await editTopicMemoryWithMap(projectRoot, 'architecture', 'old', 'new')

    assert.equal(await readFile(join(paths.memoryDir, 'architecture.md'), 'utf8'), 'state=new\n')
    const memory = await readFile(paths.memoryMd, 'utf8')
    assert.match(memory, /- `architecture` → `\.dsh\/memory\/architecture\.md`/)
  })
})

test('separate processes serialize compound writes through MEMORY.md and preserve every topic/map pair', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)

    const architecture = spawnWorker('topic-write-map', projectRoot, 'architecture', 'architecture-value\n')
    const workflow = spawnWorker('topic-write-map', projectRoot, 'workflow', 'workflow-value\n')
    await Promise.all([architecture.ready, workflow.ready])
    await Promise.all([architecture.done, workflow.done])

    assert.equal(await readFile(join(paths.memoryDir, 'architecture.md'), 'utf8'), 'architecture-value\n')
    assert.equal(await readFile(join(paths.memoryDir, 'workflow.md'), 'utf8'), 'workflow-value\n')
    const memory = await readFile(paths.memoryMd, 'utf8')
    assert.equal((memory.match(/`architecture`/g) ?? []).length, 1)
    assert.equal((memory.match(/`workflow`/g) ?? []).length, 1)
    await assertMissing(`${paths.memoryMd}.lock`)
    await assertMissing(`${join(paths.memoryDir, 'architecture.md')}.lock`)
    await assertMissing(`${join(paths.memoryDir, 'workflow.md')}.lock`)
  })
})

test('compound transactions acquire MEMORY.md before the topic lock', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)
    const topicPath = join(paths.memoryDir, 'architecture.md')
    const heldMemory = await holdWriterLock(paths.memoryMd)
    const worker = spawnWorker('topic-write-map', projectRoot, 'architecture', 'ordered-locks\n')

    await worker.ready
    const finishedEarly = await Promise.race([
      worker.done.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
    ])
    assert.equal(finishedEarly, false)
    await assertMissing(`${topicPath}.lock`)
    await assertMissing(topicPath)

    heldMemory.release()
    await heldMemory.done
    await worker.done

    assert.equal(await readFile(topicPath, 'utf8'), 'ordered-locks\n')
  })
})

test('concurrent compound exact edits retain both independent changes and one map entry', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const topicPath = join(paths.memoryDir, 'architecture.md')
    await writeProjectMemoryBootstrap(projectRoot, BASE_MEMORY)
    await writeTopicMemory(projectRoot, 'architecture', 'first=old-a\nsecond=old-b\n')

    const first = spawnWorker('topic-edit-map', projectRoot, 'architecture', 'old-a', 'new-a')
    const second = spawnWorker('topic-edit-map', projectRoot, 'architecture', 'old-b', 'new-b')
    await Promise.all([first.ready, second.ready])
    await Promise.all([first.done, second.done])

    assert.equal(await readFile(topicPath, 'utf8'), 'first=new-a\nsecond=new-b\n')
    const memory = await readFile(paths.memoryMd, 'utf8')
    assert.equal((memory.match(/`architecture`/g) ?? []).length, 1)
  })
})
