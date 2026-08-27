import { PrimaryWebSearchError } from './errors.js'
import type { PrimarySearchSource, PrimaryWebSearchResult } from './types.js'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new PrimaryWebSearchError('WEB_SEARCH_PROTOCOL', `web_search provider returned non-string ${label}`)
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function sourceUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PrimaryWebSearchError('WEB_SEARCH_PROTOCOL', 'web_search provider returned a source without a string URL')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new PrimaryWebSearchError('WEB_SEARCH_PROTOCOL', `web_search provider returned an invalid source URL: ${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PrimaryWebSearchError(
      'WEB_SEARCH_PROTOCOL',
      `web_search provider returned unsupported source URL protocol: ${parsed.protocol}`,
    )
  }
  return parsed.toString()
}

export function normalizeProviderResult(value: unknown, maxResults: number): PrimaryWebSearchResult {
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('maxResults must be a positive integer')
  const row = record(value)
  if (!row || !Array.isArray(row.sources)) {
    throw new PrimaryWebSearchError('WEB_SEARCH_PROTOCOL', 'web_search provider returned malformed structured output')
  }

  const content = optionalText(row.content, 'content')
  const sources: PrimarySearchSource[] = []
  const seen = new Set<string>()
  let truncated = false
  for (const rawSource of row.sources) {
    const source = record(rawSource)
    if (!source) throw new PrimaryWebSearchError('WEB_SEARCH_PROTOCOL', 'web_search provider returned a malformed source entry')
    const url = sourceUrl(source.url)
    if (seen.has(url)) continue
    seen.add(url)
    if (sources.length >= maxResults) {
      truncated = true
      continue
    }
    const title = optionalText(source.title, 'source title')
    const snippet = optionalText(source.snippet, 'source snippet')
    const publishedAt = optionalText(source.publishedAt, 'source publishedAt')
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    })
  }
  return {
    ...(content === undefined ? {} : { content }),
    sources,
    truncated,
  }
}
