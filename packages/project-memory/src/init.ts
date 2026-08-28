import { lstat, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  ensureCanonicalDirectory,
  withSafeFileWriterLock,
  writeSafeFileAtomically,
} from './filesystem.js'
import { ensureProjectMemoryBootstrap } from './bootstrap.js'
import { resolveProjectMemoryPaths } from './paths.js'

export const INITIAL_DSH_MD_CONTENT = `# DSH Project Contract

This file contains stable project-specific instructions for DSH agents.

- Keep durable learned project state in \`.dsh/memory/\`.
- Keep transient runtime state in \`.dsh/local/\`.
- Never store secrets, credentials, or current quota values in project memory.

Users can edit this file after initialization.
`

export const INITIAL_PROJECT_JSON_CONTENT = `{\n  "schemaVersion": 1\n}\n`

export interface ProjectInitCreated {
  dshMd: boolean
  projectJson: boolean
  memoryMd: boolean
  localDir: boolean
  gitignoreEntry: boolean
}

export interface ProjectInitResult {
  projectRoot: string
  created: ProjectInitCreated
}

async function validateExistingFile(filePath: string, logicalName: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Canonical path for "${logicalName}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
    return true
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return false
    }
    throw err
  }
}

async function validateExistingDir(dirPath: string, logicalName: string): Promise<boolean> {
  try {
    const stats = await lstat(dirPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `Canonical path component for "${logicalName}" must be a real directory, not a symbolic link or non-directory entry`,
      )
    }
    return true
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return false
    }
    throw err
  }
}

async function validateExistingProjectJson(projectJsonPath: string): Promise<boolean> {
  const exists = await validateExistingFile(projectJsonPath, '.dsh/project.json')
  if (!exists) {
    return false
  }

  const raw = await readFile(projectJsonPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Canonical ".dsh/project.json" contains malformed JSON')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as any).schemaVersion !== 1
  ) {
    throw new Error('Canonical ".dsh/project.json" must be an object with schemaVersion === 1')
  }

  return true
}

/** Ensure the project-owned ignore rule under the root .gitignore writer lock. */
async function ensureGitignoreEntry(
  projectRoot: string,
  gitignorePath: string,
): Promise<boolean> {
  return withSafeFileWriterLock(projectRoot, gitignorePath, async () => {
    let content: string
    try {
      content = await readFile(gitignorePath, 'utf8')
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err

      try {
        await writeFile(gitignorePath, '.dsh/local/\n', {
          encoding: 'utf8',
          flag: 'wx',
        })
        return true
      } catch (createErr: any) {
        // Preserve a non-cooperating external creator instead of overwriting
        // it; after EEXIST, validate and fold our line into the winner.
        if (createErr?.code !== 'EEXIST') throw createErr
        await validateExistingFile(gitignorePath, '.gitignore')
        content = await readFile(gitignorePath, 'utf8')
      }
    }

    const lines = content.split(/\r?\n/)
    const hasEntry = lines.some((line) => {
      const trimmed = line.trim()
      return trimmed === '.dsh/local/' || trimmed === '/.dsh/local/'
    })

    if (hasEntry) {
      return false
    }

    const prefix =
      content.length === 0 || content.endsWith('\n') || content.endsWith('\r') ? '' : '\n'
    const appendContent = `${prefix}.dsh/local/\n`
    const updatedBuffer = Buffer.from(content + appendContent, 'utf8')
    await writeSafeFileAtomically(projectRoot, gitignorePath, updatedBuffer)
    return true
  })
}

/**
 * Initializes a DSH project root idempotently.
 *
 * Requirements:
 * - Requires explicit absolute projectRoot path (rejects relative paths before mutation).
 * - Creates when missing:
 *   - DSH.md
 *   - .dsh/project.json
 *   - .dsh/memory/MEMORY.md
 *   - .dsh/local/
 *   - .gitignore entry for .dsh/local/
 *
 * Never overwrites existing user-authored DSH.md, project.json, MEMORY.md,
 * or unrelated .gitignore content. Fails closed on symlinks/non-regular entries.
 */
export async function initializeDshProject(projectRoot: string): Promise<ProjectInitResult> {
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    throw new Error('Project root must be an absolute path')
  }

  const root = projectRoot
  const paths = resolveProjectMemoryPaths(root)
  const dshDir = join(root, '.dsh')
  const gitignorePath = join(root, '.gitignore')

  // 1. Preflight known existing canonical targets before mutation
  await validateExistingFile(paths.dshMd, 'DSH.md')
  await validateExistingDir(dshDir, '.dsh')
  await validateExistingProjectJson(paths.projectJson)
  await validateExistingDir(paths.memoryDir, '.dsh/memory')
  await validateExistingFile(paths.memoryMd, '.dsh/memory/MEMORY.md')
  await validateExistingDir(paths.localDir, '.dsh/local')
  await validateExistingFile(gitignorePath, '.gitignore')

  // 2. Ensure .dsh directory
  await ensureCanonicalDirectory(dshDir)

  // 3. Create DSH.md if absent
  let dshMdCreated = false
  const dshMdExists = await validateExistingFile(paths.dshMd, 'DSH.md')
  if (!dshMdExists) {
    try {
      await writeFile(paths.dshMd, INITIAL_DSH_MD_CONTENT, {
        encoding: 'utf8',
        flag: 'wx',
      })
      dshMdCreated = true
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        await validateExistingFile(paths.dshMd, 'DSH.md')
      } else {
        throw err
      }
    }
  }

  // 4. Create .dsh/project.json if absent
  let projectJsonCreated = false
  const projectJsonExists = await validateExistingProjectJson(paths.projectJson)
  if (!projectJsonExists) {
    try {
      await writeFile(paths.projectJson, INITIAL_PROJECT_JSON_CONTENT, {
        encoding: 'utf8',
        flag: 'wx',
      })
      projectJsonCreated = true
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        await validateExistingProjectJson(paths.projectJson)
      } else {
        throw err
      }
    }
  }

  // 5. Ensure MEMORY.md bootstrap
  const bootstrapResult = await ensureProjectMemoryBootstrap(root)

  // 6. Ensure .dsh/local/ directory
  let localDirCreated = false
  const localDirExists = await validateExistingDir(paths.localDir, '.dsh/local')
  if (!localDirExists) {
    await ensureCanonicalDirectory(paths.localDir)
    localDirCreated = true
  }

  // 7. Ensure root .gitignore ignores .dsh/local/. Creation and RMW both
  // participate in the same cross-process writer lock.
  const gitignoreEntryCreated = await ensureGitignoreEntry(root, gitignorePath)

  return {
    projectRoot: root,
    created: {
      dshMd: dshMdCreated,
      projectJson: projectJsonCreated,
      memoryMd: bootstrapResult.created,
      localDir: localDirCreated,
      gitignoreEntry: gitignoreEntryCreated,
    },
  }
}
