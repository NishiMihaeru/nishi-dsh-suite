/** External Codex CLI resolution for the usage source. */

import { accessSync, constants } from 'node:fs'
import { posix, win32 } from 'node:path'

export const CODEX_EXECUTABLE_ENV = 'DSH_CODEX_EXECUTABLE'

export interface ResolvedVendorExecutable {
  readonly executable: string
  readonly source: 'override' | 'path'
}

export interface CodexExecutableResolutionOptions {
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

/** Resolve Codex only from DSH_CODEX_EXECUTABLE or the current PATH. */
export function resolveCodexExecutable(
  options: CodexExecutableResolutionOptions = {},
): ResolvedVendorExecutable {
  const env = options.env ?? process.env
  const isExecutable = options.isExecutable ?? executableByDefault
  const platform = options.platform ?? process.platform
  const pathApi = platform === 'win32' ? win32 : posix
  const override = env[CODEX_EXECUTABLE_ENV]?.trim()

  if (override !== undefined && override.length > 0) {
    if (!isExecutable(override)) {
      throw new Error(
        `codex-usage-source: configured Codex executable is not executable: ${JSON.stringify(override)}`,
      )
    }
    return { executable: override, source: 'override' }
  }

  const executableName = platform === 'win32' ? 'codex.exe' : 'codex'
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  for (const directory of pathValue.split(pathApi.delimiter)) {
    if (directory.length === 0) continue
    const candidate = pathApi.join(directory, executableName)
    if (isExecutable(candidate)) return { executable: candidate, source: 'path' }
  }

  throw new Error(
    `codex-usage-source: Codex CLI is unavailable; install Codex and ensure ${JSON.stringify(executableName)} is on PATH or set ${CODEX_EXECUTABLE_ENV}`,
  )
}
