import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  initializeDshProject,
  resolveProjectMemoryPaths,
  writeProjectMemoryBootstrap,
  writeTopicMemory,
} from '../src/index.js'

const RMW_WORKER = fileURLToPath(new URL('./fixtures/rmw-worker.mjs', import.meta.url))

async function withTempProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-atomic-test-'))
  try {
    await fn(projectRoot)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
}

interface RmwWorker {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  done: Promise<void>
  stdout: () => string
  stderr: () => string
}

function spawnRmwWorker(...args: string[]): RmwWorker {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', RMW_WORKER, ...args],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stdout = ''
  let stderr = ''
  let readyResolved = false
  let resolveReady!: () => void
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
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(
        `RMW worker exited with code=${String(code)} signal=${String(signal)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ))
    })
  })

  return {
    child,
    ready,
    done,
    stdout: () => stdout,
    stderr: () => stderr,
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

async function assertWorkerBlocked(worker: RmwWorker, label: string): Promise<void> {
  await worker.ready
  const completedEarly = await Promise.race([
    worker.done.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
  ])
  assert.equal(
    completedEarly,
    false,
    `${label} ignored the existing cross-process writer lock; stdout=${worker.stdout()} stderr=${worker.stderr()}`,
  )
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path)
    assert.fail(`Expected ${path} to be absent`)
  } catch (error: any) {
    assert.equal(error?.code, 'ENOENT')
  }
}

test('bootstrap write refuses a pre-existing symlink target without mutating its referent', async (t) => {
  if (process.platform === 'win32') {
    t.skip('file symlink creation is not reliably available on Windows')
    return
  }

  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const outsideDir = await mkdtemp(join(tmpdir(), 'dsh-memory-atomic-outside-'))
    const outsideFile = join(outsideDir, 'outside-memory.md')
    const sentinel = 'OUTSIDE_BOOTSTRAP_SENTINEL'
    try {
      await mkdir(paths.memoryDir, { recursive: true })
      await writeFile(outsideFile, sentinel, 'utf8')
      await symlink(outsideFile, paths.memoryMd, 'file')

      await assert.rejects(
        () => writeProjectMemoryBootstrap(projectRoot, '# Project Memory\n'),
        /regular file|symbolic link|non-regular/,
      )
      assert.equal(await readFile(outsideFile, 'utf8'), sentinel)
    } finally {
      await rm(outsideDir, { recursive: true, force: true })
    }
  })
})

test('topic write refuses a pre-existing symlink target without mutating its referent', async (t) => {
  if (process.platform === 'win32') {
    t.skip('file symlink creation is not reliably available on Windows')
    return
  }

  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const outsideDir = await mkdtemp(join(tmpdir(), 'dsh-memory-topic-outside-'))
    const outsideFile = join(outsideDir, 'outside-topic.md')
    const topicPath = join(paths.memoryDir, 'architecture.md')
    const sentinel = 'OUTSIDE_TOPIC_SENTINEL'
    try {
      await mkdir(paths.memoryDir, { recursive: true })
      await writeFile(outsideFile, sentinel, 'utf8')
      await symlink(outsideFile, topicPath, 'file')

      await assert.rejects(
        () => writeTopicMemory(projectRoot, 'architecture', '# Architecture\n'),
        /regular file|symbolic link|non-regular/,
      )
      assert.equal(await readFile(outsideFile, 'utf8'), sentinel)
    } finally {
      await rm(outsideDir, { recursive: true, force: true })
    }
  })
})

test('MEMORY.md map update and exact edit serialize across processes and preserve both changes', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(
      projectRoot,
      '# Project Memory\n\n## Current state\nalpha-state\n\n## Memory map\nNo topic memories yet.\n',
    )

    const held = await holdWriterLock(paths.memoryMd)
    const edit = spawnRmwWorker('bootstrap-edit', projectRoot, 'alpha-state', 'beta-state')
    const map = spawnRmwWorker('memory-map', projectRoot, 'architecture')

    await Promise.all([
      assertWorkerBlocked(edit, 'bootstrap exact edit'),
      assertWorkerBlocked(map, 'Memory map update'),
    ])

    held.release()
    await held.done
    await Promise.all([edit.done, map.done])

    const final = await readFile(paths.memoryMd, 'utf8')
    assert.match(final, /beta-state/)
    assert.match(final, /- `architecture` → `\.dsh\/memory\/architecture\.md`/)
    await assertMissing(`${paths.memoryMd}.lock`)
  })
})

test('independent topic exact edits from separate processes re-read under one writer lock', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const topicPath = join(paths.memoryDir, 'architecture.md')
    await writeTopicMemory(projectRoot, 'architecture', 'first=old-a\nsecond=old-b\n')

    const held = await holdWriterLock(topicPath)
    const first = spawnRmwWorker('topic-edit', projectRoot, 'architecture', 'old-a', 'new-a')
    const second = spawnRmwWorker('topic-edit', projectRoot, 'architecture', 'old-b', 'new-b')

    await Promise.all([
      assertWorkerBlocked(first, 'first topic edit'),
      assertWorkerBlocked(second, 'second topic edit'),
    ])

    held.release()
    await held.done
    await Promise.all([first.done, second.done])

    assert.equal(await readFile(topicPath, 'utf8'), 'first=new-a\nsecond=new-b\n')
    await assertMissing(`${topicPath}.lock`)
  })
})

test('whole-file topic writers honor the same lock used by topic RMW edits', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const topicPath = join(paths.memoryDir, 'architecture.md')
    await writeTopicMemory(projectRoot, 'architecture', 'old content\n')

    const held = await holdWriterLock(topicPath)
    const writer = spawnRmwWorker('topic-write', projectRoot, 'architecture', 'replacement content\n')
    await assertWorkerBlocked(writer, 'whole-file topic writer')

    held.release()
    await held.done
    await writer.done

    assert.equal(await readFile(topicPath, 'utf8'), 'replacement content\n')
    await assertMissing(`${topicPath}.lock`)
  })
})

test('project initialization preserves existing .gitignore content under the file writer lock', async () => {
  await withTempProject(async (projectRoot) => {
    await initializeDshProject(projectRoot)
    const gitignorePath = join(projectRoot, '.gitignore')
    await writeFile(gitignorePath, 'node_modules/\n', 'utf8')

    const held = await holdWriterLock(gitignorePath)
    const worker = spawnRmwWorker('init', projectRoot)
    await assertWorkerBlocked(worker, 'project .gitignore initialization')

    held.release()
    await held.done
    await worker.done

    const final = await readFile(gitignorePath, 'utf8')
    assert.match(final, /^node_modules\/\n/m)
    assert.equal(
      final.split(/\r?\n/).filter((line) => line.trim() === '.dsh/local/').length,
      1,
      'initializer must add exactly one .dsh/local/ rule',
    )
    await assertMissing(`${gitignorePath}.lock`)
  })
})
