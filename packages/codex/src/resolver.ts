/**
 * External Codex CLI resolution for the Nishi Codex provider.
 *
 * The Suite never inspects npm global state, vendor homes, package-manager
 * databases, or credential stores. Runtime discovery is intentionally limited
 * to one explicit environment override followed by the current PATH.
 *
 * This module is a thin Codex-flavoured wrapper around the shared
 * `nishi-dsh-provider-kit` resolver: the walk itself (env override, then
 * PATH, fail closed on an invalid override) lives in the kit, and this
 * module only supplies the Codex descriptor and supplies the Codex descriptor. Diagnostics are the kit's,
 * so every provider reports resolution failures the same way.
 *
 * @module nishi-dsh-codex/resolver
 */

import { resolveVendorExecutable, type VendorExecutableDescriptor } from 'nishi-dsh-provider-kit'

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

const CODEX_DESCRIPTOR: VendorExecutableDescriptor = {
  id: 'subagent-codex',
  defaultName: 'codex',
  envOverride: CODEX_EXECUTABLE_ENV,
  windowsName: 'codex.exe',
  productName: 'Codex CLI',
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
  // `config` is never supplied here, so the kit can only report 'override' or 'path'.
  return resolveVendorExecutable(CODEX_DESCRIPTOR, options) as ResolvedVendorExecutable
}
