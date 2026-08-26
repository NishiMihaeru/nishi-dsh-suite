/**
 * External Codex CLI resolution for the Nishi Codex provider.
 *
 * The Suite never inspects npm global state, vendor homes, package-manager
 * databases, or credential stores. Runtime discovery is intentionally limited
 * to one explicit environment override followed by the current PATH.
 *
 * @module nishi-dsh-codex/resolver
 */

import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

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

/**
 * Resolve the official Codex CLI without installing or inspecting a second
 * package-local Codex runtime.
 *
 * An explicit DSH_CODEX_EXECUTABLE value is authoritative: if it is invalid,
 * resolution fails closed instead of silently selecting a different binary.
 */
export function resolveCodexExecutable(
  options: CodexExecutableResolutionOptions = {},
): ResolvedVendorExecutable {
  const env = options.env ?? process.env
  const isExecutable = options.isExecutable ?? executableByDefault
  const platform = options.platform ?? process.platform
  const override = env[CODEX_EXECUTABLE_ENV]?.trim()

  if (override !== undefined && override.length > 0) {
    if (!isExecutable(override)) {
      throw new Error(
        `subagent-codex: configured Codex executable is not executable: ${JSON.stringify(override)}`,
      )
    }
    return { executable: override, source: 'override' }
  }

  const executableName = platform === 'win32' ? 'codex.exe' : 'codex'
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue
    const candidate = join(directory, executableName)
    if (isExecutable(candidate)) return { executable: candidate, source: 'path' }
  }

  throw new Error(
    `subagent-codex: Codex CLI is unavailable; install Codex and ensure ${JSON.stringify(executableName)} is on PATH or set ${CODEX_EXECUTABLE_ENV}`,
  )
}
