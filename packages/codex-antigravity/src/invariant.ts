/**
 * Package-owned invariant companion for `nishi-dsh-codex-antigravity`.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-codex/src/invariant.ts
 *
 * @module nishi-dsh-codex-antigravity/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

const PACKAGE_NAME = 'nishi-dsh-codex-antigravity'

/** Cordis companion plugin name. */
export const name = 'subagent-codex-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: lifecycle pairing belongs to the shared subagent
 * service and process-tree ownership belongs to the subprocess service.
 */
const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<void> =>
  Promise.resolve((ctx as any).invariants.register(PACKAGE_NAME, install))
