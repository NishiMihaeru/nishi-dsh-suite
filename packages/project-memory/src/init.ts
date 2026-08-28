import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import {
  ensureCanonicalDirectory,
  readSafeRegularFile,
  withSafeFileWriterLock,
  writeFileExclusiveAtomic,
} from './filesystem.js'
import { ensureProjectMemoryBootstrap } from './bootstrap.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { recoverPendingProjectMemoryTransaction } from './transaction.js'

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
    if (err?.code === 'ENOENT') return false
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
    if (err?.code === 'ENOENT') return false
    throw err
  }
}

async function validateExistingProjectJson(
  projectJsonPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const exists = await validateExistingFile(projectJsonPath, '.dsh/project.json')
  if (!exists) return false

  const raw = await readSafeRegularFile(dirname(projectJsonPath), projectJsonPath, { signal })
  if (raw === null) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
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

async function ensureGitignoreEntry(
  projectRoot: string,
  gitignorePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const rootOptions = { allowDirectorySymlink: true } as const
  return withSafeFileWriterLock(projectRoot, gitignorePath, async (scope) => {
    signal?.throwIfAborted()
    let raw = await scope.readRegularFile(gitignorePath)
    if (raw === null) {
      const created = await scope.writeFileExclusiveAtomic(
        gitignorePath,
        '.dsh/local/\n',
        { mode: 0o644 },
      )
      if (created) return true
      raw = await scope.readRegularFile(gitignorePath)
      if (raw === null) throw new Error('Canonical .gitignore disappeared during initialization')
    }

    const content = raw.toString('utf8')
    const lines = content.split(/\r?\n/)
    const hasEntry = lines.some((line) => {
      const trimmed = line.trim()
      return trimmed === '.dsh/local/' || trimmed === '/.dsh/local/'
    })
    if (hasEntry) return false

    const prefix =
      content.length === 0 || content.endsWith('\n') || content.endsWith('\r') ? '' : '\n'
    const appendContent = `${prefix}.dsh/local/\n`
    signal?.throwIfAborted()
    await scope.writeFileAtomically(
      gitignorePath,
      Buffer.from(content + appendContent, 'utf8'),
    )
    return true
  }, signal, rootOptions)
}

export async function initializeDshProject(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<ProjectInitResult> {
  signal?.throwIfAborted()
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    throw new Error('Project root must be an absolute path')
  }

  const root = projectRoot
  const paths = resolveProjectMemoryPaths(root)
  const dshDir = join(root, '.dsh')
  const gitignorePath = join(root, '.gitignore')

  await validateExistingFile(paths.dshMd, 'DSH.md')
  await validateExistingDir(dshDir, '.dsh')
  await validateExistingProjectJson(paths.projectJson, signal)
  await validateExistingDir(paths.memoryDir, '.dsh/memory')
  await validateExistingFile(paths.memoryMd, '.dsh/memory/MEMORY.md')
  await validateExistingDir(paths.localDir, '.dsh/local')
  await validateExistingFile(gitignorePath, '.gitignore')
  signal?.throwIfAborted()

  await recoverPendingProjectMemoryTransaction(root, signal)
  signal?.throwIfAborted()

  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })

  const dshMdCreated = await writeFileExclusiveAtomic(
    root,
    paths.dshMd,
    INITIAL_DSH_MD_CONTENT,
    { mode: 0o644 },
    signal,
    { allowDirectorySymlink: true },
  )
  if (!dshMdCreated) await validateExistingFile(paths.dshMd, 'DSH.md')

  const projectJsonCreated = await writeFileExclusiveAtomic(
    dshDir,
    paths.projectJson,
    INITIAL_PROJECT_JSON_CONTENT,
    { mode: 0o644 },
    signal,
  )
  if (!projectJsonCreated) await validateExistingProjectJson(paths.projectJson, signal)

  const bootstrapResult = await ensureProjectMemoryBootstrap(root, signal)

  const localDirExists = await validateExistingDir(paths.localDir, '.dsh/local')
  if (!localDirExists) await ensureCanonicalDirectory(paths.localDir, signal)
  const localDirCreated = !localDirExists

  const gitignoreEntryCreated = await ensureGitignoreEntry(root, gitignorePath, signal)

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
