import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  resolveProjectMemoryPaths,
  writeProjectMemoryBootstrap,
  writeTopicMemory,
} from '../src/index.js'

async function withTempProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-atomic-test-'))
  try {
    await fn(projectRoot)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
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
