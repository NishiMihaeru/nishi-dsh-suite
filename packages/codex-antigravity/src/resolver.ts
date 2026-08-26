/**
 * Deterministic resolution of managed package-local Codex native binaries
 * and code-mode host runtime across Windows, macOS, and Linux.
 *
 * Upstream Reference:
 * @openai/codex@0.147.0 (bin/codex.js)
 *
 * @module dsh-subagent-codex-custom/resolver
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const TARGET_TRIPLE_BY_PLATFORM: Readonly<Record<string, string>> = Object.freeze({
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'android-x64': 'x86_64-unknown-linux-musl',
  'android-arm64': 'aarch64-unknown-linux-musl',
})

export const PLATFORM_PACKAGE_BY_TARGET: Readonly<Record<string, string>> = Object.freeze({
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
})

export interface ResolvedCodexRuntime {
  readonly executable: string
  readonly codeModeHost: string
  readonly binDir: string
  readonly vendorDir: string
  readonly version: string
  readonly targetTriple: string
}

const defaultRequire = createRequire(import.meta.url)

/**
 * Resolves the managed Codex native binary and code-mode host runtime
 * from the package-local @openai/codex installation without relying on global PATH.
 *
 * @param platform - OS platform (defaults to process.platform)
 * @param arch - CPU architecture (defaults to process.arch)
 * @param callerRequire - Node require function rooted in a module that can resolve @openai/codex
 * @returns Fully validated paths to the managed native codex and code-mode host executables
 */
export function resolveManagedCodexRuntime(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  callerRequire: NodeRequire = defaultRequire,
): ResolvedCodexRuntime {
  const key = `${platform}-${arch}`
  const targetTriple = TARGET_TRIPLE_BY_PLATFORM[key]
  if (!targetTriple) {
    throw new Error(
      `subagent-codex: unsupported platform/architecture combination: ${platform} (${arch})`,
    )
  }

  const platformPkg = PLATFORM_PACKAGE_BY_TARGET[targetTriple]
  if (!platformPkg) {
    throw new Error(`subagent-codex: unsupported target triple: ${targetTriple}`)
  }

  let codexPkgJsonPath: string
  try {
    codexPkgJsonPath = callerRequire.resolve('@openai/codex/package.json')
  } catch (error) {
    throw new Error(
      `subagent-codex: failed to resolve @openai/codex package manifest: ${(error as Error).message}`,
    )
  }

  const codexPkgDir = dirname(codexPkgJsonPath)
  const codexRequire = createRequire(codexPkgJsonPath)

  let rawManifest: string
  try {
    rawManifest = readFileSync(codexPkgJsonPath, 'utf8')
  } catch (error) {
    throw new Error(
      `subagent-codex: failed to read @openai/codex package manifest at "${codexPkgJsonPath}": ${(error as Error).message}`,
    )
  }

  let codexManifest: { version?: unknown }
  try {
    codexManifest = JSON.parse(rawManifest) as { version?: unknown }
  } catch (error) {
    throw new Error(
      `subagent-codex: failed to parse @openai/codex package manifest at "${codexPkgJsonPath}": ${(error as Error).message}`,
    )
  }

  if (
    typeof codexManifest.version !== 'string'
    || codexManifest.version.trim().length === 0
  ) {
    throw new Error(
      `subagent-codex: @openai/codex package manifest at "${codexPkgJsonPath}" is missing a valid non-empty version`,
    )
  }
  const version = codexManifest.version.trim()

  let vendorRoot: string
  try {
    const platformPkgJsonPath = codexRequire.resolve(`${platformPkg}/package.json`)
    vendorRoot = join(dirname(platformPkgJsonPath), 'vendor')
  } catch {
    vendorRoot = join(codexPkgDir, 'vendor')
  }

  const vendorDir = join(vendorRoot, targetTriple)
  const binDir = join(vendorDir, 'bin')
  const exeName = platform === 'win32' ? 'codex.exe' : 'codex'
  const hostName = platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host'

  const executable = join(binDir, exeName)
  const codeModeHost = join(binDir, hostName)

  if (!existsSync(executable)) {
    throw new Error(
      `subagent-codex: managed Codex executable not found at "${executable}" for ${targetTriple}`,
    )
  }

  if (!existsSync(codeModeHost)) {
    throw new Error(
      `subagent-codex: managed Codex code-mode host executable not found at "${codeModeHost}" for ${targetTriple}`,
    )
  }

  return {
    executable,
    codeModeHost,
    binDir,
    vendorDir,
    version,
    targetTriple,
  }
}

/**
 * Prepend a directory to a PATH string using the platform path delimiter.
 */
export function prependPath(
  dir: string,
  existingPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  const delimiter = platform === 'win32' ? ';' : ':'
  if (!existingPath || existingPath.trim().length === 0) {
    return dir
  }
  const parts = existingPath.split(delimiter).filter(Boolean)
  if (parts.includes(dir)) {
    return existingPath
  }
  return [dir, ...parts].join(delimiter)
}
