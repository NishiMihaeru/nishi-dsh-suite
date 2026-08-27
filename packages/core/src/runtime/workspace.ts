/**
 * Ephemeral `.agents/agents/<name>/agent.md` workspace provisioning.
 *
 * Several vendor CLI bridges (a native search backend, a primary model
 * transport) each create a throwaway temp directory containing a managed-agent
 * definition — and sometimes an extra file such as a JSON output schema —
 * pass it to the CLI via `--add-dir`, and remove it afterwards. This module
 * is that provisioning, written once.
 *
 * @module nishi-dsh-core/runtime/workspace
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** One extra file to materialise under the workspace root, alongside `agent.md`. */
export interface EphemeralAgentWorkspaceFile {
  /** Portable path relative to the workspace root, using `/` as separator. */
  readonly path: string
  readonly content: string
}

export interface EphemeralAgentWorkspaceSpec {
  /** Single-segment `mkdtemp` prefix, e.g. 'dsh-vendor-search-'. */
  readonly prefix: string
  /** The managed agent's `name:` — also one directory segment under `.agents/agents/`. */
  readonly agentName: string
  /** Content written to `.agents/agents/<agentName>/agent.md`. */
  readonly agentMarkdown: string
  /** Additional confined root-relative files to write, such as a JSON schema. */
  readonly files?: readonly EphemeralAgentWorkspaceFile[]
  /** Override for `node:os` `tmpdir()`, for tests. */
  readonly tmpdir?: () => string
}

export interface EphemeralAgentWorkspace {
  /** The temp directory root, suitable for a CLI's `--add-dir`. */
  readonly root: string
  /** `<root>/.agents/agents/<agentName>`. */
  readonly agentDir: string
  /** `<agentDir>/agent.md`. */
  readonly agentMarkdownPath: string
  /** Extra file paths keyed by their spec-relative path, absolute on disk. */
  readonly files: Readonly<Record<string, string>>
  /** Remove the entire workspace tree. Idempotent; never throws. */
  dispose(): Promise<void>
}

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u
const PATH_SEPARATOR = /[\\/]/u

function safeSingleSegment(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`nishi-core: ${context} must be a non-empty string`)
  }
  if (value === '.' || value === '..' || PATH_SEPARATOR.test(value)) {
    throw new Error(`nishi-core: ${context} must be a single path segment`)
  }
  if (value.includes('\0')) {
    throw new Error(`nishi-core: ${context} must not contain NUL`)
  }
  return value
}

/**
 * Accept one portable root-relative path and reject every spelling whose
 * meaning changes across POSIX and Windows. Forward slashes are the contract;
 * empty/dot/traversal segments and absolute/drive/UNC paths are refused.
 */
function safeWorkspaceRelativePath(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`nishi-core: ${context} must be a non-empty string`)
  }
  if (value.includes('\0')) {
    throw new Error(`nishi-core: ${context} must not contain NUL`)
  }
  if (isAbsolute(value) || WINDOWS_ABSOLUTE_PATH.test(value)) {
    throw new Error(`nishi-core: ${context} must be relative to the workspace root`)
  }
  if (value.includes('\\')) {
    throw new Error(`nishi-core: ${context} must use forward slashes as path separators`)
  }

  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`nishi-core: ${context} must not contain empty, dot, or traversal segments`)
  }
  return value
}

function resolveInside(root: string, portablePath: string, context: string): string {
  const target = resolve(root, ...portablePath.split('/'))
  const fromRoot = relative(root, target)
  if (
    fromRoot.length === 0
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    throw new Error(`nishi-core: ${context} escapes the workspace root`)
  }
  return target
}

/**
 * Create the temp `.agents/agents/<name>/agent.md` tree (plus any extra
 * files) as one unit.
 *
 * Every path-shaped input is validated before `tmpdir()` or `mkdtemp()` is
 * touched. Once a fresh root exists, every extra file is resolved again and
 * proven to remain below that root before any filesystem mutation. If a
 * later write/mkdir fails, the partially-built root is removed before the
 * error propagates.
 */
export async function ephemeralAgentWorkspace(
  spec: EphemeralAgentWorkspaceSpec,
): Promise<EphemeralAgentWorkspace> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('nishi-core: workspace spec must be a non-null object')
  }

  const prefix = safeSingleSegment(spec.prefix, 'spec.prefix')
  const agentName = safeSingleSegment(spec.agentName, 'spec.agentName')
  if (typeof spec.agentMarkdown !== 'string') {
    throw new Error('nishi-core: spec.agentMarkdown must be a string')
  }
  if (spec.files !== undefined && !Array.isArray(spec.files)) {
    throw new Error('nishi-core: spec.files must be an array when provided')
  }

  const preparedFiles = (spec.files ?? []).map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error(`nishi-core: workspace files[${index}] must be a non-null object`)
    }
    const path = safeWorkspaceRelativePath(file.path, 'workspace file.path')
    if (typeof file.content !== 'string') {
      throw new Error(`nishi-core: workspace files[${index}].content must be a string`)
    }
    return { path, content: file.content }
  })

  const tmpdirFn = spec.tmpdir ?? tmpdir
  if (typeof tmpdirFn !== 'function') {
    throw new Error('nishi-core: spec.tmpdir must be a function when provided')
  }
  const root = await mkdtemp(join(tmpdirFn(), prefix))

  try {
    const agentDir = resolve(root, '.agents', 'agents', agentName)
    const agentFromRoot = relative(root, agentDir)
    if (
      agentFromRoot.length === 0
      || agentFromRoot === '..'
      || agentFromRoot.startsWith(`..${sep}`)
      || isAbsolute(agentFromRoot)
    ) {
      throw new Error('nishi-core: agent directory escapes the workspace root')
    }

    await mkdir(agentDir, { recursive: true })
    const agentMarkdownPath = join(agentDir, 'agent.md')
    await writeFile(agentMarkdownPath, spec.agentMarkdown, 'utf8')

    const files: Record<string, string> = {}
    for (const file of preparedFiles) {
      const filePath = resolveInside(root, file.path, 'workspace file.path')
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, file.content, 'utf8')
      files[file.path] = filePath
    }

    let disposed = false
    return {
      root,
      agentDir,
      agentMarkdownPath,
      files,
      async dispose(): Promise<void> {
        if (disposed) return
        disposed = true
        await rm(root, { recursive: true, force: true }).catch(() => {})
      },
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
