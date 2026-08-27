/**
 * Route one search to the backend the active primary declared.
 *
 * Before `0.1.0-rc.3` this module imported the two provider packages by name
 * and switched on their route ids, which is why the core could not live in the
 * same package as its own web-search tool: it depended on the packages that
 * depend on it. The provider registry inverts that — the core resolves a
 * backend by route and never names a provider.
 *
 * @module nishi-dsh-core/web-search/providers
 */

import { PrimaryWebSearchError, type PrimaryWebSearchErrorCode } from './errors.js'
import { normalizeProviderResult } from './result.js'
import type { PrimarySearchRoute } from './route.js'
import type {
  PrimarySearchBackendResolver,
  PrimarySearchRequest,
  PrimaryWebSearchResult,
} from './types.js'

const BACKEND_ERROR_CODES = new Set<PrimaryWebSearchErrorCode>([
  'WEB_SEARCH_PROVIDER_ERROR',
  'WEB_SEARCH_PROTOCOL',
  'WEB_SEARCH_ABORTED',
])

/**
 * Re-shape a backend error into the tool's taxonomy when — and only when —
 * the backend declared one of the codes the contract recognizes. Anything
 * else propagates untouched rather than being relabelled into a code it does
 * not mean.
 */
function rethrowBackendError(error: unknown): never {
  if (error instanceof PrimaryWebSearchError) throw error
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code?: unknown }).code
    if (typeof code === 'string' && BACKEND_ERROR_CODES.has(code as PrimaryWebSearchErrorCode)) {
      throw new PrimaryWebSearchError(code as PrimaryWebSearchErrorCode, error.message, { cause: error })
    }
  }
  throw error
}

export async function dispatchPrimarySearch(
  route: PrimarySearchRoute,
  request: PrimarySearchRequest,
  signal: AbortSignal,
  resolveBackend: PrimarySearchBackendResolver,
): Promise<PrimaryWebSearchResult> {
  const backend = resolveBackend(route.provider)
  if (backend === undefined) {
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
