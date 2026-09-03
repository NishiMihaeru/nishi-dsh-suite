import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subprocess'
import { ephemeralAgentWorkspace, VendorFailure } from 'nishi-dsh-core/runtime'
import { AgyTurnProcess } from './agy-session.js'
import {
  nativeToolNames,
  record,
  resolveVendorInvocation,
  SEARCH_NATIVE_ALLOWLIST,
  unexpectedNativeTools,
  type VendorInvocation,
} from './agy-vendor.js'
import { antigravityVendorFailure } from './vendor-stderr.js'

const AGENT_NAME = 'dsh-web-search'
const WINDOWS_EXECUTABLE_ENV = 'DSH_PRIMARY_WEB_SEARCH_AGY_EXECUTABLE'

export type AntigravityWebSearchBackendErrorCode =
  | 'WEB_SEARCH_PROVIDER_ERROR'
  | 'WEB_SEARCH_PROTOCOL'
  | 'WEB_SEARCH_ABORTED'

export class AntigravityWebSearchBackendError extends Error {
  readonly code: AntigravityWebSearchBackendErrorCode

  constructor(code: AntigravityWebSearchBackendErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AntigravityWebSearchBackendError'
    this.code = code
  }
}

export interface AntigravitySearchRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly cwd?: string
}

export interface AntigravitySearchRequest {
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

export interface AntigravitySearchBackendConfig {
  readonly executable: string
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
}

function bounded(value: unknown): string {
  const text = String(value ?? '')
  return text.length <= 2_000 ? text : `${text.slice(0, 2_000)}…`
}

function agentMarkdown(): string {
  return `---\nname: ${AGENT_NAME}\ndescription: Search-only backend for a parent DSH web_search tool.\nmainAgent: true\nsubagent: false\ninheritCustomizations: false\ntools:\n  - search_web\n  - finish\n---\n\n# Instructions\n\nYou are a search-only backend for DeepSeek Harness.\n- Use search_web for the supplied query.\n- Do not use local files, shell commands, URL-fetch tools, MCP, skills, plugins, or subagents.\n- Return only URLs actually observed in search_web results.\n- Return only structured output matching the active JSON schema.\n`
}

function promptFor(query: string): string {
  return [
    'Search the public web for the query below using search_web.',
    'Return only sources actually observed in the search results.',
    'For unavailable title, snippet, or publishedAt fields return an empty string.',
    'Provide a concise content summary grounded only in those results; return an empty string when no result supports one.',
    '',
    `Query: ${query}`,
  ].join('\n')
}

function effortArgs(value: string | undefined): string[] {
  return value === 'low' || value === 'medium' || value === 'high' ? ['--effort', value] : []
}

function structuredResult(result: { readonly structured_output?: unknown; readonly response?: unknown }): unknown {
  const structured = record(result.structured_output)
  if (structured) return structured
  if (typeof result.response !== 'string' || result.response.trim().length === 0) {
    throw new AntigravityWebSearchBackendError('WEB_SEARCH_PROTOCOL', 'Antigravity web_search returned no structured output')
  }
  try {
    return JSON.parse(result.response) as unknown
  } catch (error) {
    throw new AntigravityWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      `Antigravity web_search returned invalid structured JSON: ${bounded(error instanceof Error ? error.message : error)}`,
      { cause: error },
    )
  }
}

function searchFailure(
  error: unknown,
  parentSignal: AbortSignal,
  timeoutSignal: AbortSignal,
  timeoutMs: number,
): AntigravityWebSearchBackendError {
  if (error instanceof AntigravityWebSearchBackendError) return error
  if (parentSignal.aborted) {
    return new AntigravityWebSearchBackendError('WEB_SEARCH_ABORTED', 'Antigravity web_search was aborted')
  }
  if (timeoutSignal.aborted) {
    return new AntigravityWebSearchBackendError(
      'WEB_SEARCH_PROVIDER_ERROR',
      `Antigravity web_search timed out after ${timeoutMs}ms`,
    )
  }
  if (error instanceof LlmError) {
    const cause = error.cause
    if (cause instanceof VendorFailure) {
      return new AntigravityWebSearchBackendError(
        'WEB_SEARCH_PROVIDER_ERROR',
        `Antigravity web_search exited before a result event. ${cause.message}`,
        { cause },
      )
    }
    return new AntigravityWebSearchBackendError(
      error.code === 'ANTIGRAVITY_PROTOCOL' ? 'WEB_SEARCH_PROTOCOL' : 'WEB_SEARCH_PROVIDER_ERROR',
      error.message
        .replaceAll('Antigravity CLI', 'Antigravity web_search')
        .replaceAll('Antigravity subprocess', 'Antigravity web_search subprocess'),
      { cause: error },
    )
  }
  return error instanceof Error
    ? new AntigravityWebSearchBackendError('WEB_SEARCH_PROVIDER_ERROR', error.message, { cause: error })
    : new AntigravityWebSearchBackendError('WEB_SEARCH_PROVIDER_ERROR', String(error))
}

/** Official agy search_web backend. This class does not register a DSH tool. */
export class AntigravitySearchBackend {
  constructor(private readonly ctx: Context, private readonly config: AntigravitySearchBackendConfig) {}

  async search(route: AntigravitySearchRoute, request: AntigravitySearchRequest, parentSignal: AbortSignal): Promise<unknown> {
    const schemaFile = 'search-output.schema.json'
    const workspace = await ephemeralAgentWorkspace({
      prefix: 'dsh-web-search-agy-',
      agentName: AGENT_NAME,
      agentMarkdown: agentMarkdown(),
      files: [{ path: schemaFile, content: JSON.stringify(SEARCH_OUTPUT_SCHEMA) }],
    })
    const root = workspace.root
    const schemaPath = workspace.files[schemaFile]
    try {
      const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs)
      const signal = AbortSignal.any([parentSignal, timeoutSignal])
      const args = [
        '--add-dir', root,
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--json-schema', schemaPath,
        '--agent', AGENT_NAME,
        '--sandbox',
        '--model', route.model,
        ...effortArgs(route.reasoningEffort),
        '--print-timeout', `${Math.max(1, Math.ceil(this.config.timeoutMs / 1000))}s`,
      ]
      const invocation = await this.invocation(args, signal)
      let child: AgyTurnProcess | undefined
      try {
        child = await AgyTurnProcess.start(this.ctx, {
          argv: invocation.argv,
          env: invocation.env,
          cwd: root,
          graceMs: this.config.disposeGraceMs,
          stderrMaxBytes: this.config.stderrMaxBytes,
          build: () => undefined,
          stage: 'web-search-exit',
        }, signal)
        const payload = `${JSON.stringify({ event: 'user', message: { content: promptFor(request.query) } })}\n`
        const { result, events } = await child.turn(payload, signal)
        if (result.status !== 'SUCCESS') {
          // result.error is a structured, vendor-authored application-error field (not
          // process stderr), but it is still arbitrary text supplied by the vendor
          // process -- treat it the same way as stderr for sanitisation purposes so
          // nothing vendor-authored reaches the caller unrecognised.
          const failure = antigravityVendorFailure({
            stage: 'web-search',
            stderrText: typeof result.error === 'string' ? result.error : undefined,
          })
          throw new AntigravityWebSearchBackendError(
            'WEB_SEARCH_PROVIDER_ERROR',
            `Antigravity native web_search failed for model ${JSON.stringify(route.model)} (status ${String(result.status)}). ${failure.message}`,
            { cause: failure },
          )
        }
        if (!nativeToolNames(events).includes('search_web')) {
          throw new AntigravityWebSearchBackendError('WEB_SEARCH_PROTOCOL', `Antigravity model ${JSON.stringify(route.model)} completed the hidden search turn without search_web`)
        }
        const unexpected = unexpectedNativeTools(events, SEARCH_NATIVE_ALLOWLIST)
        if (unexpected.length > 0) {
          throw new AntigravityWebSearchBackendError('WEB_SEARCH_PROTOCOL', `Antigravity hidden search turn invoked unexpected native tool(s): ${unexpected.join(', ')}`)
        }
        return structuredResult(result)
      } catch (error: unknown) {
        throw searchFailure(error, parentSignal, timeoutSignal, this.config.timeoutMs)
      } finally {
        if (child !== undefined) await child.close()
      }
    } finally {
      await workspace.dispose()
    }
  }

  private async invocation(args: readonly string[], signal: AbortSignal): Promise<VendorInvocation> {
    return await resolveVendorInvocation(
      this.ctx,
      this.config.executable,
      this.config.env,
      args,
      signal,
      WINDOWS_EXECUTABLE_ENV,
    )
  }
}
