import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  resolveProjectMemoryPaths,
  ensureProjectMemoryBootstrap,
  readProjectMemoryBootstrap,
  MAX_BOOTSTRAP_LINES,
  MAX_BOOTSTRAP_BYTES,
  INITIAL_MEMORY_MD_CONTENT,
} from '../src/index.js'

async function withTempProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-project-memory-test-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('A. Canonical path resolution: resolves deterministic fixed memory paths without persisting personal state', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const expectedRoot = resolve(projectRoot)

    assert.equal(paths.projectRoot, expectedRoot)
    assert.equal(paths.dshMd, join(expectedRoot, 'DSH.md'))
    assert.equal(paths.projectJson, join(expectedRoot, '.dsh', 'project.json'))
    assert.equal(paths.memoryDir, join(expectedRoot, '.dsh', 'memory'))
    assert.equal(paths.memoryMd, join(expectedRoot, '.dsh', 'memory', 'MEMORY.md'))
    assert.equal(paths.localDir, join(expectedRoot, '.dsh', 'local'))
  })
})

test('B. Minimal bootstrap creation: creates exact approved initial MEMORY.md when absent', async () => {
  await withTempProject(async (projectRoot) => {
    const result = await ensureProjectMemoryBootstrap(projectRoot)
    const paths = resolveProjectMemoryPaths(projectRoot)

    assert.equal(result.created, true)
    assert.equal(result.memoryPath, paths.memoryMd)
    await access(paths.memoryDir, constants.F_OK)
    await access(paths.memoryMd, constants.F_OK)

    const rawContent = await readFile(paths.memoryMd, 'utf8')
    assert.equal(rawContent, INITIAL_MEMORY_MD_CONTENT)

    const expectedContent = [
      '# Project Memory',
      '',
      '## Current state',
      'Project initialized in DSH.',
      '',
      '## Memory map',
      'No topic memories yet.',
      '',
    ].join('\n')
    assert.equal(rawContent, expectedContent)
  })
})

test('C. Idempotency: ensure is idempotent and preserves pre-existing MEMORY.md byte-for-byte', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })

    const customContent = '# Custom Memory\n\n## Important Notes\n- Pre-existing architecture constraint.\n'
    await writeFile(paths.memoryMd, customContent, 'utf8')

    const result = await ensureProjectMemoryBootstrap(projectRoot)
    assert.equal(result.created, false)
    assert.equal(result.memoryPath, paths.memoryMd)
    assert.equal(await readFile(paths.memoryMd, 'utf8'), customContent)
  })
})

test('D. Bounded bootstrap read: returns small file exactly without modification', async () => {
  await withTempProject(async (projectRoot) => {
    await ensureProjectMemoryBootstrap(projectRoot)
    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, true)
    assert.equal(readResult.content, INITIAL_MEMORY_MD_CONTENT)
  })
})

test('E. Bounded bootstrap read: line cap never exceeds 200 lines', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })
    const lines: string[] = []
    for (let i = 1; i <= 300; i++) lines.push(`Line ${i}: short note on project behavior.`)
    await writeFile(paths.memoryMd, lines.join('\n') + '\n', 'utf8')

    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, true)
    assert.ok(readResult.content !== null)
    const returnedLines = readResult.content.split('\n')
    const nonTrailingLines = readResult.content.endsWith('\n')
      ? returnedLines.slice(0, -1)
      : returnedLines

    assert.equal(nonTrailingLines.length, 200)
    assert.equal(nonTrailingLines[0], 'Line 1: short note on project behavior.')
    assert.equal(nonTrailingLines[199], 'Line 200: short note on project behavior.')
    assert.equal(MAX_BOOTSTRAP_LINES, 200)
  })
})

test('F. Bounded bootstrap read: byte cap never exceeds 25 KiB (25600 bytes)', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })
    const lines: string[] = []
    for (let i = 1; i <= 50; i++) lines.push(`Line ${i} ${'x'.repeat(950)}`)
    await writeFile(paths.memoryMd, lines.join('\n') + '\n', 'utf8')

    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, true)
    assert.ok(readResult.content !== null)
    const byteLength = Buffer.byteLength(readResult.content, 'utf8')
    assert.ok(byteLength <= 25 * 1024, `Byte length ${byteLength} must be <= 25600 bytes`)
    assert.equal(MAX_BOOTSTRAP_BYTES, 25 * 1024)
  })
})

test('G. Bounded bootstrap read: enforces BOTH line cap and byte cap simultaneously', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })
    const lines: string[] = []
    for (let i = 1; i <= 350; i++) lines.push(`Line ${i.toString().padStart(3, '0')} ${'y'.repeat(180)}`)
    await writeFile(paths.memoryMd, lines.join('\n') + '\n', 'utf8')

    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, true)
    assert.ok(readResult.content !== null)
    const byteLength = Buffer.byteLength(readResult.content, 'utf8')
    assert.ok(byteLength <= 25 * 1024, `Byte length ${byteLength} must be <= 25600 bytes`)
    const returnedLines = readResult.content.split('\n')
    const effectiveLines = readResult.content.endsWith('\n') ? returnedLines.slice(0, -1) : returnedLines
    assert.ok(effectiveLines.length <= 200, `Line count ${effectiveLines.length} must be <= 200`)
  })
})

test('H. Bounded bootstrap read: preserves valid UTF-8 near byte boundary with multibyte sequences', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })
    const prefix = 'A'.repeat(25598)
    const fullContent = prefix + '🚀' + ' trailing text'
    await writeFile(paths.memoryMd, fullContent, 'utf8')

    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, true)
    assert.ok(readResult.content !== null)
    const byteLength = Buffer.byteLength(readResult.content, 'utf8')
    assert.ok(byteLength <= 25 * 1024, `Byte length ${byteLength} must be <= 25600`)
    assert.ok(!readResult.content.includes('\uFFFD'), 'Must not contain malformed UTF-8 replacement character')
    assert.equal(readResult.content, prefix)
  })
})

test('I. Missing MEMORY.md: read does not silently auto-create file and returns exists=false', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, false)
    assert.equal(readResult.content, null)
    assert.equal(readResult.path, paths.memoryMd)
    let fileExists = true
    try {
      await access(paths.memoryMd, constants.F_OK)
    } catch {
      fileExists = false
    }
    assert.equal(fileExists, false, 'Read operation must not create missing MEMORY.md')
  })
})

test('J. Topic memory isolation: reader does not automatically concatenate or load topic files', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await mkdir(paths.memoryDir, { recursive: true })
    await writeFile(paths.memoryMd, INITIAL_MEMORY_MD_CONTENT, 'utf8')
    await writeFile(join(paths.memoryDir, 'architecture.md'), '# Architecture Topic Memory\nDetailed architectural decisions.\n', 'utf8')
    await writeFile(join(paths.memoryDir, 'database.md'), '# Database Topic Memory\nSchema details.\n', 'utf8')

    const readResult = await readProjectMemoryBootstrap(projectRoot)
    assert.equal(readResult.exists, true)
    assert.equal(readResult.content, INITIAL_MEMORY_MD_CONTENT)
    assert.ok(!readResult.content.includes('Architecture Topic Memory'))
    assert.ok(!readResult.content.includes('Database Topic Memory'))
  })
})

async function assertMemoryPathRejectsExternalTarget(projectRoot: string, useParentLink: boolean): Promise<void> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const outsideDir = await mkdtemp(join(tmpdir(), 'dsh-outside-memory-'))
  const sentinelContent = 'CONFIDENTIAL_SENTINEL_TOKEN_12345'
  try {
    if (useParentLink) {
      await writeFile(join(outsideDir, 'MEMORY.md'), sentinelContent, 'utf8')
      await mkdir(join(projectRoot, '.dsh'), { recursive: true })
      await symlink(outsideDir, join(projectRoot, '.dsh', 'memory'), process.platform === 'win32' ? 'junction' : 'dir')
    } else {
      await mkdir(paths.memoryDir, { recursive: true })
      const outsideTarget = join(outsideDir, 'secret-sentinel.md')
      await writeFile(outsideTarget, sentinelContent, 'utf8')
      await symlink(outsideTarget, paths.memoryMd, 'file')
    }

    await assert.rejects(() => readProjectMemoryBootstrap(projectRoot), (err: any) => {
      assert.ok(!err.message.includes(sentinelContent))
      return true
    })
    await assert.rejects(() => ensureProjectMemoryBootstrap(projectRoot), (err: any) => {
      assert.ok(!err.message.includes(sentinelContent))
      return true
    })
  } finally {
    await rm(outsideDir, { recursive: true, force: true })
  }
}

test('K/L. Symlink security: read and ensure fail closed on symlinked MEMORY.md', async (t) => {
  if (process.platform === 'win32') {
    t.skip('file symlink creation is not reliably available on Windows hosted CI')
    return
  }
  await withTempProject((projectRoot) => assertMemoryPathRejectsExternalTarget(projectRoot, false))
})

test('N. Parent path security: ensure and read fail closed on .dsh/memory directory symlink/junction', async () => {
  await withTempProject((projectRoot) => assertMemoryPathRejectsExternalTarget(projectRoot, true))
})

test('O. Parent path security: ensure and read fail closed on .dsh directory symlink/junction', async () => {
  await withTempProject(async (projectRoot) => {
    const outsideDshDir = await mkdtemp(join(tmpdir(), 'dsh-outside-dsh-dir-'))
    const outsideMemoryDir = join(outsideDshDir, 'memory')
    await mkdir(outsideMemoryDir, { recursive: true })
    const outsideMemoryFile = join(outsideMemoryDir, 'MEMORY.md')
    const sentinelContent = 'CONFIDENTIAL_OUTSIDE_DSH_O_SENTINEL_445566'
    await writeFile(outsideMemoryFile, sentinelContent, 'utf8')
    try {
      await symlink(outsideDshDir, join(projectRoot, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir')
      await assert.rejects(() => readProjectMemoryBootstrap(projectRoot), (err: any) => {
        assert.ok(!err.message.includes(sentinelContent))
        return true
      })
      await assert.rejects(() => ensureProjectMemoryBootstrap(projectRoot), (err: any) => {
        assert.ok(!err.message.includes(sentinelContent))
        return true
      })
      assert.equal(await readFile(outsideMemoryFile, 'utf8'), sentinelContent)
    } finally {
      await rm(outsideDshDir, { recursive: true, force: true })
    }
  })
})
