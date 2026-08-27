import type { PrimarySearchRoute } from './route.js'

export interface PrimarySearchRequest {
  readonly query: string
  readonly maxResults: number
}

export interface PrimarySearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

export interface PrimaryWebSearchResult {
  readonly content?: string
  readonly sources: readonly PrimarySearchSource[]
  readonly truncated: boolean
}

/**
 * One provider's native search backend. Providers implement this and declare
 * it on their descriptor; the core owns the tool, the route resolution, the
 * error taxonomy and result normalization, and never knows which providers
 * exist.
 */
export interface PrimarySearchBackend {
  search(
    route: PrimarySearchRoute,
    request: PrimarySearchRequest,
    signal: AbortSignal,
  ): Promise<unknown>
}

/**
 * Resolve the backend serving one DSH model route, or `undefined` when the
 * route's provider is unknown or declares no search capability. Both cases
 * are the same honest outcome for the caller: search is unsupported here.
 */
export type PrimarySearchBackendResolver = (providerRoute: string) => PrimarySearchBackend | undefined
