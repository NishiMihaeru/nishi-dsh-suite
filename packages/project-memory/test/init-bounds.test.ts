import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  initializeDshProject,
  MAX_GITIGNORE_BYTES,
  MAX_PROJECT_JSON_BYTES,
} from '../src/index.js'

test('initialization fails closed on an oversized .dsh/project.json instead of materializing it whole', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-init-project-json-bound-'))
  try {
    const dshDir = join(projectRoot, '.dsh')
    await mkdir(dshDir, { recursive: true })
    const oversized = Buffer.alloc(MAX_PROJECT_JSON_BYTES + 1, 0x20)
    await writeFile(join(dshDir, 'project.json'), oversized)

    await assert.rejects(
      initializeDshProject(projectRoot),
      /exceeds maximum size limit of \d+ bytes/,
    )
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('initialization fails closed on an oversized .gitignore instead of materializing it whole', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-init-gitignore-bound-'))
  try {
    const oversized = Buffer.alloc(MAX_GITIGNORE_BYTES + 1, 0x2e) // '.'
    await writeFile(join(projectRoot, '.gitignore'), oversized)

    await assert.rejects(
      initializeDshProject(projectRoot),
      /exceeds maximum size limit of \d+ bytes/,
    )
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})
