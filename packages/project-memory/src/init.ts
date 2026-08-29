import { lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  withSafeFileWriterLock,
  writeFileExclusiveAtomic,
  type SafeDirectoryScope,
} from './filesystem.js'
import { ensureProjectMemoryBootstrap } from './bootstrap.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { withEnsuredProjectDshScope } from './storage.js'
import { recoverPendingProjectMemoryTransaction } from './transaction.js'

export const INITIAL_DSH_MD_CONTENT = `# DSH Project Contract

This file contains stable project-specific instructions for DSH agents.

- Keep durable learned project state in \`.dsh/memory/\`.
- Keep transient runtime state in \`.dsh/local/\`.
- Never store secrets, credentials, or current quota values in project memory.

Users can edit this file after initialization.
`

export const INITIAL_PROJECT_JSON_CONTENT = `{\n  "schemaVersion": 1\n}\n`

// `.dsh/project.json` only ever holds a tiny `{"schemaVersion":1}` payload;
// 64 KiB is generous headroom while still rejecting an unbounded read of a
// file anyone with repository access could otherwise replace.
export const MAX_PROJECT_JSON_BYTES = 64 * 1024
// `.gitignore` is user-owned free-form content outside package control, so it
// can legitimately grow much larger than project.json, but this read-modify-
// write path still must not materialize an unbounded file.
export const MAX_GITIGNORE_BYTES = 1024 * 1024

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

function validateProjectJsonBuffer(raw: Buffer): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('Canonical ".dsh/project.json" contains malformed JSON')
  }

  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || (parsed as any).schemaVersion !== 1
  ) {
    throw new Error('Canonical ".dsh/project.json" must be an object with schemaVersion === 1')
  }
}

async function ensureProjectJson(
  dshScope: SafeDirectoryScope,
  projectJsonPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const existing = await dshScope.readRegularFile(projectJsonPath, { maxBytes: MAX_PROJECT_JSON_BYTES })
  if (existing !== null) {
    validateProjectJsonBuffer(existing)
    return false
  }

  const created = await dshScope.writeFileExclusiveAtomic(
    projectJsonPath,
    INITIAL_PROJECT_JSON_CONTENT,
    { mode: 0o644 },
  )
  if (created) return true

  const winner = await dshScope.readRegularFile(projectJsonPath, { maxBytes: MAX_PROJECT_JSON_BYTES })
  if (winner === null) throw new Error('Canonical ".dsh/project.json" disappeared during initialization')
  validateProjectJsonBuffer(winner)
  return false
}

async function ensureGitignoreEntry(
  projectRoot: string,
  gitignorePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const rootOptions = { allowDirectorySymlink: true } as const
  return withSafeFileWriterLock(projectRoot, gitignorePath, async (scope) => {
    signal?.throwIfAborted()
    let raw = await scope.readRegularFile(gitignorePath, { maxBytes: MAX_GITIGNORE_BYTES })
    if (raw === null) {
      const created = await scope.writeFileExclusiveAtomic(
        gitignorePath,
        '.dsh/local/\n',
        { mode: 0o644 },
      )
      if (created) return true
      raw = await scope.readRegularFile(gitignorePath, { maxBytes: MAX_GITIGNORE_BYTES })
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
    signal?.throwIfAborted()
    await scope.writeFileAtomically(
      gitignorePath,
      Buffer.from(`${content}${prefix}.dsh/local/\n`, 'utf8'),
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

  // Root-level preflight is safe because these are direct children of the
  // explicit workspace root. Package-owned descendants are validated through
  // the descriptor chain below rather than by reopening full pathnames.
  await validateExistingFile(paths.dshMd, 'DSH.md')
  await validateExistingDir(dshDir, '.dsh')
  await validateExistingFile(gitignorePath, '.gitignore')
  signal?.throwIfAborted()

  await recoverPendingProjectMemoryTransaction(root, signal)
  signal?.throwIfAborted()

  const dshMdCreated = await writeFileExclusiveAtomic(
    root,
    paths.dshMd,
    INITIAL_DSH_MD_CONTENT,
    { mode: 0o644 },
    signal,
    { allowDirectorySymlink: true },
  )
  if (!dshMdCreated) await validateExistingFile(paths.dshMd, 'DSH.md')

  const projectJsonCreated = await withEnsuredProjectDshScope(
    root,
    (dshScope) => ensureProjectJson(dshScope, paths.projectJson, signal),
    signal,
  )

  const bootstrapResult = await ensureProjectMemoryBootstrap(root, signal)

  let localDirCreated = false
  await withEnsuredProjectDshScope(root, async (dshScope) => {
    const existing = await dshScope.withExistingChildDirectory(paths.localDir, async () => true)
    if (existing !== undefined) return
    await dshScope.withEnsuredChildDirectory(paths.localDir, async () => undefined)
    localDirCreated = true
  }, signal)

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
