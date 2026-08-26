/** External Claude Code CLI resolution for the Nishi Claude provider. */

import { accessSync, constants } from 'node:fs'
import { posix, win32 } from 'node:path'

export const CLAUDE_EXECUTABLE_ENV = 'DSH_CLAUDE_EXECUTABLE'

export interface ResolvedVendorExecutable {
  readonly executable: string
  readonly source: 'override' | 'path'
}

export interface ClaudeExecutableResolutionOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly isExecutable?: (path: string) => boolean
  readonly platform?: NodeJS.Platform
}

function executableByDefault(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the official Claude Code CLI using only the explicit override and
 * the current PATH. Vendor homes, package-manager state, and credentials are
 * intentionally outside this resolver's boundary.
 */
export function resolveClaudeExecutable(
  options: ClaudeExecutableResolutionOptions = {},
): ResolvedVendorExecutable {
  const env = options.env ?? process.env
  const isExecutable = options.isExecutable ?? executableByDefault
  const platform = options.platform ?? process.platform
  const pathApi = platform === 'win32' ? win32 : posix
  const override = env[CLAUDE_EXECUTABLE_ENV]?.trim()

  if (override !== undefined && override.length > 0) {
    if (!isExecutable(override)) {
      throw new Error(
        `subagent-claude-code: configured Claude executable is not executable: ${JSON.stringify(override)}`,
      )
    }
    return { executable: override, source: 'override' }
  }

  const executableName = platform === 'win32' ? 'claude.exe' : 'claude'
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  for (const directory of pathValue.split(pathApi.delimiter)) {
    if (directory.length === 0) continue
    const candidate = pathApi.join(directory, executableName)
    if (isExecutable(candidate)) return { executable: candidate, source: 'path' }
  }

  throw new Error(
    `subagent-claude-code: Claude CLI is unavailable; install Claude Code and ensure ${JSON.stringify(executableName)} is on PATH or set ${CLAUDE_EXECUTABLE_ENV}`,
  )
}
