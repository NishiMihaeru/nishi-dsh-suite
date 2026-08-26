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

export interface PrimarySearchBackend {
  search(
    route: PrimarySearchRoute,
    request: PrimarySearchRequest,
    signal: AbortSignal,
  ): Promise<unknown>
}
