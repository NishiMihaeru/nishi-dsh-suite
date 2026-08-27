import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { dispatchPrimarySearch } from './providers.js'
import { resolvePrimarySearchRoute, type PrimarySearchRoute } from './route.js'
import type { PrimarySearchBackendResolver, PrimaryWebSearchResult } from './types.js'
import {
  formatSearchOutput,
  mergeSearchResults,
  parseSearchArgs,
  presentSearchCall,
  presentSearchResult,
  projectSource,
  searchMetaFromResult,
  searchMetaFromValue,
  WEB_SEARCH_MAX_QUERIES,
  WEB_SEARCH_MAX_RESULTS,
  type WebSearchArgs,
  type WebSearchMeta,
} from './presentation.js'

export {
  formatSearchOutput,
  mergeSearchResults,
  parseSearchArgs,
  presentSearchCall,
  presentSearchResult,
  searchMetaFromResult,
  searchMetaFromValue,
  WEB_SEARCH_MAX_QUERIES,
  WEB_SEARCH_MAX_RESULTS,
}
export type { WebSearchArgs, WebSearchMeta }

async function runSearchQueries(
  route: PrimarySearchRoute,
  queries: string[],
  maxResults: number,
  signal: AbortSignal,
  resolveBackend: PrimarySearchBackendResolver,
): Promise<PrimaryWebSearchResult> {
  if (queries.length === 1) {
    return dispatchPrimarySearch(route, { query: queries[0] as string, maxResults }, signal, resolveBackend)
  }
  const controller = new AbortController()
  const batchSignal = AbortSignal.any([signal, controller.signal])
  let firstFailure: { error: unknown } | undefined
  const results: PrimaryWebSearchResult[] = []
  const searches = queries.map(async (query, index) => {
    try {
      results[index] = await dispatchPrimarySearch(route, { query, maxResults }, batchSignal, resolveBackend)
    } catch (error) {
      if (firstFailure === undefined) firstFailure = { error }
      controller.abort(error)
      throw error
    }
  })
  await Promise.allSettled(searches)
  if (firstFailure !== undefined) throw firstFailure.error
  return mergeSearchResults(queries, results, maxResults)
}

export function applyPrimaryWebSearchTool(
  ctx: Context,
  options: {
    readonly maxResults: number
    readonly maxQueries: number
    readonly timeoutMs: number
    readonly resolveBackend: PrimarySearchBackendResolver
  },
): void {
  ctx.systemPrompt.section({
    name: 'tool:web_search',
    order: 110,
    text: `Use the web_search tool to discover current information on the web. The required queries array accepts 1–${options.maxQueries} non-empty search queries; use a one-item array for a single search. Search is routed through the current session's selected primary provider/model and returns an optional answer plus source URLs. Cite the relevant URLs as markdown links.`,
  })

  ctx.tools.register(defineTool({
    name: 'web_search',
    description: `Search the web using the current session's primary provider/model. Provide 1–${options.maxQueries} queries in the required queries array.`,
    parameters: {
      queries: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `Required search queries; accepts 1–${options.maxQueries} items and merges their results.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value) }],
      presentationMeta: (_args, value) => searchMetaFromValue(value),
    },
    timeoutMs: options.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args: WebSearchArgs, exec) {
      const queries = parseSearchArgs(args, options.maxQueries)
      const route = resolvePrimarySearchRoute(exec)
      const result = await runSearchQueries(route, queries, options.maxResults, exec.signal, options.resolveBackend)
      return {
        ...(result.content === undefined ? {} : { content: result.content }),
        sources: result.sources.map(projectSource),
        truncated: result.truncated,
      }
    },
    presentCall: presentSearchCall,
    presentResult: presentSearchResult,
  }))
}
