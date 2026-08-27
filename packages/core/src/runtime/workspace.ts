/**
 * Ephemeral `.agents/agents/<name>/agent.md` workspace provisioning.
 *
 * Several vendor CLI bridges (Codex/Antigravity subagent delegation, the
 * Antigravity web-search backend, the Antigravity primary model transport)
 * each create a throwaway temp directory containing a managed-agent
 * definition — and sometimes an extra file such as a JSON output schema —
 * pass it to the CLI via `--add-dir`, and remove it afterwards. This module
 * is that provisioning, written once.
 *
 * @module nishi-dsh-core/runtime/workspace
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** One extra file to materialise under the workspace root, alongside `agent.md`. */
export interface EphemeralAgentWorkspaceFile {
  /** Path relative to the workspace root, e.g. 'search-output.schema.json'. */
  readonly path: string
  readonly content: string
}

export interface EphemeralAgentWorkspaceSpec {
  /** `mkdtemp` prefix, e.g. 'dsh-antigravity-subagent-'. */
  readonly prefix: string
  /** The managed agent's `name:` — also the directory under `.agents/agents/`. */
  readonly agentName: string
  /** Content written to `.agents/agents/<agentName>/agent.md`. */
  readonly agentMarkdown: string
  /** Additional root-relative files to write, such as a JSON schema. */
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

/**
 * Create the temp `.agents/agents/<name>/agent.md` tree (plus any extra
 * files) as one unit. If any step after the root directory is created fails
 * — a write error, a bad file spec — the partially-built root is removed
 * before the error propagates, so a failed provisioning never leaks a temp
 * directory.
 */
export async function ephemeralAgentWorkspace(
  spec: EphemeralAgentWorkspaceSpec,
): Promise<EphemeralAgentWorkspace> {
  if (typeof spec.prefix !== 'string' || spec.prefix.length === 0) {
    throw new Error('provider-kit: spec.prefix must be a non-empty string')
  }
  if (typeof spec.agentName !== 'string' || spec.agentName.length === 0) {
    throw new Error('provider-kit: spec.agentName must be a non-empty string')
  }
  if (typeof spec.agentMarkdown !== 'string') {
    throw new Error('provider-kit: spec.agentMarkdown must be a string')
  }

  const tmpdirFn = spec.tmpdir ?? tmpdir
  const root = await mkdtemp(join(tmpdirFn(), spec.prefix))

  try {
    const agentDir = join(root, '.agents', 'agents', spec.agentName)
    await mkdir(agentDir, { recursive: true })
    const agentMarkdownPath = join(agentDir, 'agent.md')
    await writeFile(agentMarkdownPath, spec.agentMarkdown, 'utf8')

    const files: Record<string, string> = {}
    for (const file of spec.files ?? []) {
      if (typeof file.path !== 'string' || file.path.length === 0) {
        throw new Error('provider-kit: workspace file.path must be a non-empty string')
      }
      const filePath = join(root, file.path)
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
