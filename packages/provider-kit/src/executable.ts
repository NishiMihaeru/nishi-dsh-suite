/**
 * The single vendor CLI executable resolver.
 *
 * Every subscription-provider package (Codex, Claude, Antigravity, ...) was
 * independently walking the same env-override-then-PATH sequence, with the
 * same win32 branch, differing only in the provider name baked into their
 * diagnostics. This module is that sequence, written once and parameterised
 * by a small per-provider descriptor.
 *
 * The Suite never inspects npm global state, vendor homes, package-manager
 * databases, or credential stores. Runtime discovery is intentionally
 * limited to an explicit config value, one explicit environment override,
 * and the current PATH.
 *
 * @module nishi-dsh-provider-kit/executable
 */

import { accessSync, constants } from 'node:fs'
import { posix, win32 } from 'node:path'

/** Identity and lookup facts for one vendor executable. */
export interface VendorExecutableDescriptor {
  /** Stable provider id used in diagnostics, e.g. 'codex', 'antigravity', 'claude'. */
  readonly id: string
  /** Non-Windows PATH lookup name, e.g. 'codex', 'agy', 'claude'. */
  readonly defaultName: string
  /** Environment variable that carries an explicit override, e.g. 'DSH_CODEX_EXECUTABLE'. */
  readonly envOverride: string
  /** Windows PATH lookup name; defaults to `${defaultName}.exe`. */
  readonly windowsName?: string
  /** Human-facing product name used in diagnostics, e.g. 'Codex CLI'. Defaults to 'executable'. */
  readonly productName?: string
}

export interface ResolvedVendorExecutable {
  readonly executable: string
  readonly source: 'config' | 'override' | 'path'
}

export interface ResolveVendorExecutableOptions {
  /** Explicit configuration value; wins over the environment override and PATH when non-empty. */
  readonly config?: string
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

function requireNonEmpty(descriptorId: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`provider-kit: ${descriptorId}: descriptor.${field} must be a non-empty string`)
  }
  return value
}

/**
 * Resolve one vendor CLI executable without installing or inspecting a
 * second package-local runtime.
 *
 * Precedence is explicit config value, then `descriptor.envOverride`, then a
 * `PATH` walk. An explicit config value or environment override that fails
 * the executability check fails resolution closed — it never falls back to
 * a weaker source, so a misconfigured override cannot silently select a
 * different binary than the one requested.
 */
export function resolveVendorExecutable(
  descriptor: VendorExecutableDescriptor,
  options: ResolveVendorExecutableOptions = {},
): ResolvedVendorExecutable {
  if (descriptor === null || typeof descriptor !== 'object') {
    throw new Error('provider-kit: descriptor must be a non-null object')
  }
  const id = requireNonEmpty('<unknown>', 'id', descriptor.id)
  const defaultName = requireNonEmpty(id, 'defaultName', descriptor.defaultName)
  const envOverride = requireNonEmpty(id, 'envOverride', descriptor.envOverride)
  if (descriptor.windowsName !== undefined && descriptor.windowsName.trim().length === 0) {
    throw new Error(`provider-kit: ${id}: descriptor.windowsName must be a non-empty string when provided`)
  }

  const productName = descriptor.productName ?? 'executable'
  const env = options.env ?? process.env
  const isExecutable = options.isExecutable ?? executableByDefault
  const platform = options.platform ?? process.platform
  const pathApi = platform === 'win32' ? win32 : posix

  const config = options.config?.trim()
  if (config !== undefined && config.length > 0) {
    if (!isExecutable(config)) {
      throw new Error(
        `${id}: configured ${productName} is not executable: ${JSON.stringify(config)}`,
      )
    }
    return { executable: config, source: 'config' }
  }

  const override = env[envOverride]?.trim()
  if (override !== undefined && override.length > 0) {
    if (!isExecutable(override)) {
      throw new Error(
        `${id}: configured ${productName} is not executable: ${JSON.stringify(override)}`,
      )
    }
    return { executable: override, source: 'override' }
  }

  const executableName = platform === 'win32' ? descriptor.windowsName ?? `${defaultName}.exe` : defaultName
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  for (const directory of pathValue.split(pathApi.delimiter)) {
    if (directory.length === 0) continue
    const candidate = pathApi.join(directory, executableName)
    if (isExecutable(candidate)) return { executable: candidate, source: 'path' }
  }

  throw new Error(
    `${id}: ${productName} is unavailable; install it and ensure ${JSON.stringify(executableName)} is on PATH or set ${envOverride}`,
  )
}
