import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { PrimaryWebSearchError } from './errors.js'
import { normalizeProviderResult } from './result.js'
import type { PrimarySearchRoute } from './route.js'
import type { PrimarySearchBackend, PrimarySearchRequest, PrimaryWebSearchResult } from './types.js'
import { AntigravitySearchBackend, type AntigravitySearchBackendConfig } from './antigravity.js'
import { CodexSearchBackend } from './codex.js'

export interface PrimarySearchBackends {
  readonly codex: PrimarySearchBackend
  readonly antigravity: PrimarySearchBackend
}

export interface PrimarySearchProviderConfig {
  readonly antigravity: AntigravitySearchBackendConfig
}

export const CODEX_PRIMARY_PROVIDER = 'codex-app-server'
export const ANTIGRAVITY_PRIMARY_PROVIDER = 'antigravity-cli'

export async function dispatchPrimarySearch(
  route: PrimarySearchRoute,
  request: PrimarySearchRequest,
  signal: AbortSignal,
  backends: PrimarySearchBackends,
): Promise<PrimaryWebSearchResult> {
  let backend: PrimarySearchBackend
  switch (route.provider) {
    case CODEX_PRIMARY_PROVIDER:
      backend = backends.codex
      break
    case ANTIGRAVITY_PRIMARY_PROVIDER:
      backend = backends.antigravity
      break
    default:
      throw new PrimaryWebSearchError(
        'WEB_SEARCH_UNSUPPORTED',
        `web_search is not supported for primary provider ${JSON.stringify(route.provider)} model ${JSON.stringify(route.model)}`,
      )
  }
  const raw = await backend.search(route, request, signal)
  return normalizeProviderResult(raw, request.maxResults)
}

export function createPrimarySearchBackends(ctx: Context, config: PrimarySearchProviderConfig): PrimarySearchBackends {
  return {
    codex: new CodexSearchBackend(),
    antigravity: new AntigravitySearchBackend(ctx, config.antigravity),
  }
}
