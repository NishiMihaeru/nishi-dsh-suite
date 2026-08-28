import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, resolve } from 'node:path'
import test from 'node:test'
import {
  ensureProjectMemoryBootstrap,
  initializeDshProject,
  resolveProjectMemoryPaths,
} from '../src/index.js'
import { findProjectRoot } from '../src/runtime.js'
import { projectRootFromToolExecution } from '../src/tools.js'

test('project memory paths stay inside the explicit project root', () => {
  const projectRoot = resolve('fixture-project')
  const paths = resolveProjectMemoryPaths(projectRoot)

  assert.equal(paths.projectRoot, projectRoot)
  assert.equal(paths.dshMd, join(projectRoot, 'DSH.md'))
  assert.equal(paths.projectJson, join(projectRoot, '.dsh', 'project.json'))
  assert.equal(paths.memoryDir, join(projectRoot, '.dsh', 'memory'))
  assert.equal(paths.memoryMd, join(projectRoot, '.dsh', 'memory', 'MEMORY.md'))
  assert.equal(paths.localDir, join(projectRoot, '.dsh', 'local'))

  for (const path of Object.values(paths)) {
    assert.equal(path.startsWith(projectRoot), true)
  }
})

test('context and memory tools resolve the same git project root from a nested session cwd', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-root-'))
  try {
    await mkdir(join(projectRoot, '.git'))
    const nestedCwd = join(projectRoot, 'packages', 'feature', 'src')
    await mkdir(nestedCwd, { recursive: true })

    const contextRoot = await findProjectRoot(nestedCwd)
    const toolRoot = await projectRootFromToolExecution({
      agent: { session: { header: { cwd: nestedCwd } } },
      signal: new AbortController().signal,
    } as any)

    assert.equal(contextRoot, normalize(projectRoot))
    assert.equal(toolRoot, contextRoot)
    assert.equal(resolveProjectMemoryPaths(toolRoot).memoryMd, join(projectRoot, '.dsh', 'memory', 'MEMORY.md'))
    assert.notEqual(resolveProjectMemoryPaths(toolRoot).memoryMd, join(nestedCwd, '.dsh', 'memory', 'MEMORY.md'))
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('direct bootstrap creation keeps a symlinked explicit project root usable', async (t) => {
  if (process.platform === 'win32') {
    t.skip('directory symlink creation is not reliably available on Windows')
    return
  }

  const parent = await mkdtemp(join(tmpdir(), 'dsh-memory-symlink-bootstrap-'))
  const realRoot = join(parent, 'real-project')
  const linkedRoot = join(parent, 'linked-project')
  try {
    await mkdir(realRoot)
    await symlink(realRoot, linkedRoot, 'dir')

    const result = await ensureProjectMemoryBootstrap(linkedRoot)
    const linkedPaths = resolveProjectMemoryPaths(linkedRoot)

    assert.equal(result.created, true)
    assert.match(await readFile(linkedPaths.memoryMd, 'utf8'), /# Project Memory/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('initialization keeps a symlinked explicit project root usable while canonical .dsh components stay real', async (t) => {
  if (process.platform === 'win32') {
    t.skip('directory symlink creation is not reliably available on Windows')
    return
  }

  const parent = await mkdtemp(join(tmpdir(), 'dsh-memory-symlink-root-'))
  const realRoot = join(parent, 'real-project')
  const linkedRoot = join(parent, 'linked-project')
  try {
    await mkdir(realRoot)
    await symlink(realRoot, linkedRoot, 'dir')

    const result = await initializeDshProject(linkedRoot)
    const linkedPaths = resolveProjectMemoryPaths(linkedRoot)

    assert.equal(result.projectRoot, normalize(linkedRoot))
    assert.match(await readFile(linkedPaths.dshMd, 'utf8'), /DSH Project Contract/)
    assert.match(await readFile(linkedPaths.memoryMd, 'utf8'), /# Project Memory/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('tool root discovery fails closed for an unavailable or non-absolute session cwd', async () => {
  await assert.rejects(
    projectRootFromToolExecution({
      agent: { session: { header: {} } },
      signal: new AbortController().signal,
    } as any),
    /workspace session cwd is unavailable/,
  )

  await assert.rejects(
    projectRootFromToolExecution({
      agent: { session: { header: { cwd: 'relative/project' } } },
      signal: new AbortController().signal,
    } as any),
    /invalid workspace session cwd/,
  )
})
