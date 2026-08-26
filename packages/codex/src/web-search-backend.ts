import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Codex } from '@openai/codex-sdk'

export type CodexWebSearchBackendErrorCode =
  | 'WEB_SEARCH_PROVIDER_ERROR'
  | 'WEB_SEARCH_PROTOCOL'
  | 'WEB_SEARCH_ABORTED'

export class CodexWebSearchBackendError extends Error {
  readonly code: CodexWebSearchBackendErrorCode

  constructor(code: CodexWebSearchBackendErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CodexWebSearchBackendError'
    this.code = code
  }
}

export interface CodexSearchRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly cwd?: string
}

export interface CodexSearchRequest {
  readonly query: string
  readonly maxResults: number
}

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          snippet: { type: 'string' },
          publishedAt: { type: 'string' },
        },
        required: ['url', 'title', 'snippet', 'publishedAt'],
      },
    },
  },
  required: ['content', 'sources'],
} as const

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length <= 2_000 ? text : `${text.slice(0, 2_000)}…`
}

function effort(value: string | undefined): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return undefined
  }
}

function promptFor(query: string): string {
  return [
    'Use the native web search tool to search the public web for the query below.',
    'Do not run shell commands, inspect local files, or answer from memory alone.',
    'Return only URLs that were actually observed in native web-search results.',
    'For each source provide its URL and, when available, title, a short useful snippet, and publication date.',
    'If a field is unavailable return an empty string for that field.',
    'Provide a concise content summary grounded only in those search results; use an empty string if no result supports a summary.',
    '',
    `Query: ${query}`,
  ].join('\n')
}

/** Codex-native web search backend. This class does not register a DSH tool. */
export class CodexSearchBackend {
  async search(route: CodexSearchRoute, request: CodexSearchRequest, signal: AbortSignal): Promise<unknown> {
    const workdir = await mkdtemp(join(tmpdir(), 'dsh-web-search-codex-'))
    try {
      const codex = new Codex({ config: { features: { shell_tool: false } } })
      const inheritedEffort = effort(route.reasoningEffort)
      const thread = codex.startThread({
        model: route.model,
        workingDirectory: workdir,
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        webSearchMode: 'live',
        ...(inheritedEffort === undefined ? {} : { modelReasoningEffort: inheritedEffort }),
      })

      let turn
      try {
        turn = await thread.run(promptFor(request.query), { signal, outputSchema: SEARCH_OUTPUT_SCHEMA })
      } catch (error) {
        if (signal.aborted) {
          throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted', { cause: error })
        }
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex native web_search failed for model ${JSON.stringify(route.model)}: ${boundedError(error)}`,
          { cause: error },
        )
      }

      if (!turn.items.some(item => item.type === 'web_search')) {
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROTOCOL',
          `Codex model ${JSON.stringify(route.model)} completed the hidden search turn without a native web_search item`,
        )
      }
      if (turn.finalResponse.trim().length === 0) {
        throw new CodexWebSearchBackendError('WEB_SEARCH_PROTOCOL', 'Codex native web_search returned empty structured output')
      }
      try {
        return JSON.parse(turn.finalResponse) as unknown
      } catch (error) {
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROTOCOL',
          `Codex native web_search returned invalid structured JSON: ${boundedError(error)}`,
          { cause: error },
        )
      }
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
