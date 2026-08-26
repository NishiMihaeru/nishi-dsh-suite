import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import {
  CodexSearchBackend,
  type CodexWebSearchBackendErrorCode,
} from 'nishi-dsh-codex/web-search-backend'
import {
  AntigravitySearchBackend,
  type AntigravitySearchBackendConfig,
  type AntigravityWebSearchBackendErrorCode,
} from 'nishi-dsh-antigravity/web-search-backend'
import { PrimaryWebSearchError, type PrimaryWebSearchErrorCode } from './errors.js'
import { normalizeProviderResult } from './result.js'
import type { PrimarySearchRoute } from './route.js'
import type { PrimarySearchBackend, PrimarySearchRequest, PrimaryWebSearchResult } from './types.js'

export interface PrimarySearchBackends {
  readonly codex: PrimarySearchBackend
  readonly antigravity: PrimarySearchBackend
}

export interface PrimarySearchProviderConfig {
  readonly antigravity: AntigravitySearchBackendConfig
}

export const CODEX_PRIMARY_PROVIDER = 'codex-app-server'
export const ANTIGRAVITY_PRIMARY_PROVIDER = 'antigravity-cli'

const BACKEND_ERROR_CODES = new Set<PrimaryWebSearchErrorCode>([
  'WEB_SEARCH_PROVIDER_ERROR',
  'WEB_SEARCH_PROTOCOL',
  'WEB_SEARCH_ABORTED',
])

function rethrowBackendError(error: unknown): never {
  if (error instanceof PrimaryWebSearchError) throw error
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code?: CodexWebSearchBackendErrorCode | AntigravityWebSearchBackendErrorCode }).code
    if (code !== undefined && BACKEND_ERROR_CODES.has(code)) {
      throw new PrimaryWebSearchError(code, error.message, { cause: error })
    }
  }
  throw error
}

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

  let raw: unknown
  try {
    raw = await backend.search(route, request, signal)
  } catch (error) {
    rethrowBackendError(error)
  }
  return normalizeProviderResult(raw, request.maxResults)
}

export function createPrimarySearchBackends(ctx: Context, config: PrimarySearchProviderConfig): PrimarySearchBackends {
  const codex = new CodexSearchBackend()
  const antigravity = new AntigravitySearchBackend(ctx, config.antigravity)
  return {
    codex: {
      search(route, request, signal) {
        return codex.search(route, request, signal)
      },
    },
    antigravity: {
      search(route, request, signal) {
        return antigravity.search(route, request, signal)
      },
    },
  }
}
