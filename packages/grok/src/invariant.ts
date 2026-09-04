import type { Context } from '@deepseek-ai/cordis'

const PACKAGE_NAME = 'nishi-dsh-grok'

export const name = 'grok-invariant'
export const inject = ['invariants']

const install = (): void => {}

export const apply = (ctx: Context): Promise<void> =>
  Promise.resolve((ctx as any).invariants.register(PACKAGE_NAME, install))
