import type { Context } from '@deepseek-ai/cordis'

const PACKAGE_NAME = 'nishi-dsh-antigravity'

export const name = 'antigravity-invariant'
export const inject = ['invariants']

const install = (): void => {}

export const apply = (ctx: Context): Promise<void> =>
  Promise.resolve((ctx as any).invariants.register(PACKAGE_NAME, install))
