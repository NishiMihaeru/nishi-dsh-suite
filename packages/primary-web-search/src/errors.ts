export type PrimaryWebSearchErrorCode =
  | 'WEB_SEARCH_ROUTE_UNAVAILABLE'
  | 'WEB_SEARCH_UNSUPPORTED'
  | 'WEB_SEARCH_PROVIDER_ERROR'
  | 'WEB_SEARCH_PROTOCOL'
  | 'WEB_SEARCH_ABORTED'

export class PrimaryWebSearchError extends Error {
  readonly code: PrimaryWebSearchErrorCode

  constructor(code: PrimaryWebSearchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PrimaryWebSearchError'
    this.code = code
  }
}
