import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { PrimaryWebSearchError } from './errors.js'

export interface PrimarySearchRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly cwd?: string
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function unavailable(message: string): never {
  throw new PrimaryWebSearchError('WEB_SEARCH_ROUTE_UNAVAILABLE', message)
}

/** Resolve the provider/model that owns the calling agent's current request. */
export function resolvePrimarySearchRoute(exec: ToolExecution): PrimarySearchRoute {
  const agent = exec.agent
  if (agent === undefined) unavailable('web_search requires a calling DSH agent session')

  const config = agent.session.requestHeader()?.config
  if (config === undefined) {
    unavailable('web_search could not resolve the current primary route from session request history')
  }

  const provider = nonBlankString(config.provider)
  const model = nonBlankString(config.model)
  if (provider === undefined || model === undefined) {
    unavailable('web_search found a request/header without a valid provider/model route')
  }

  const reasoningEffort = nonBlankString(config.reasoningEffort)
  const cwd = nonBlankString(agent.session.header.cwd)
  return {
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(cwd === undefined ? {} : { cwd }),
  }
}
