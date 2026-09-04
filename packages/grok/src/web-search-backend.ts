/**
 * Official Grok Build CLI `web_search` backend. This class does not register
 * a DSH tool: Core owns `web_search`, and this package contributes the native
 * backend the current `grok-cli` route resolves.
 *
 * @module nishi-dsh-grok/web-search-backend
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { disposeVendorChild } from 'nishi-dsh-core/runtime'
import {
  isArgListTooLong,
  record,
  resolveVendorInvocation,
  SEARCH_EFFORT,
  SEARCH_INIT_ALLOWLIST,
  SEARCH_MODEL,
  SEARCH_TOOL_NAME,
  SEARCH_VENDOR_TURN_CAP,
  headlessSearchArgv,
  type VendorInvocation,
} from './grok-vendor.js'
import { grokVendorFailure } from './vendor-stderr.js'

const WINDOWS_EXECUTABLE_ENV = 'DSH_PRIMARY_WEB_SEARCH_GROK_EXECUTABLE'
const MAX_STDOUT_BYTES = 4 * 1024 * 1024

export { SEARCH_VENDOR_TURN_CAP } from './grok-vendor.js'

export type GrokWebSearchBackendErrorCode =
  | 'WEB_SEARCH_PROVIDER_ERROR'
  | 'WEB_SEARCH_PROTOCOL'
  | 'WEB_SEARCH_ABORTED'

export class GrokWebSearchBackendError extends Error {
  readonly code: GrokWebSearchBackendErrorCode

  constructor(code: GrokWebSearchBackendErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GrokWebSearchBackendError'
    this.code = code
  }
}

export interface GrokSearchRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly cwd?: string
}

export interface GrokSearchRequest {
  readonly query: string
  readonly maxResults: number
}

export interface GrokSearchBackendConfig {
  readonly executable: string
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
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

function bounded(value: unknown): string {
  const text = String(value ?? '')
  return text.length <= 2_000 ? text : `${text.slice(0, 2_000)}…`
}

function searchSystemPrompt(): string {
  return [
    'You are a search-only backend for DeepSeek Harness.',
    '- Use web_search for the supplied query.',
    '- Do not use local files, shell commands, URL-fetch tools, MCP, skills, plugins, or subagents.',
    '- Return only URLs actually observed in web_search results.',
    '- Return only structured output matching the active JSON schema.',
  ].join('\n')
}

function promptFor(query: string, maxResults: number): string {
  return [
    'Search the public web for the query below using web_search.',
    'Return only sources actually observed in the search results.',
    `Return at most ${maxResults} sources.`,
    'For unavailable title, snippet, or publishedAt fields return an empty string.',
    'Provide a concise content summary grounded only in those results; return an empty string when no result supports one.',
    '',
    `Query: ${query}`,
  ].join('\n')
}

function promptFileBody(text: string): string {
  return JSON.stringify({ type: 'acp', content: [{ type: 'text', text }] })
}

function protocol(message: string, cause?: unknown): GrokWebSearchBackendError {
  return new GrokWebSearchBackendError('WEB_SEARCH_PROTOCOL', message, cause === undefined ? undefined : { cause })
}

function isWebSearchToolResult(content: unknown): boolean {
  if (typeof content !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(content)
    return record(parsed)?.type === 'WebSearch'
  } catch {
    return false
  }
}

function webSearchRequestCount(event: Record<string, unknown>): number {
  const usage = record(event.usage)
  const server = record(usage?.server_tool_use)
  const billed = server?.web_search_requests
  if (typeof billed === 'number' && Number.isFinite(billed) && billed > 0) return billed

  const modelUsage = record(event.modelUsage)
  if (modelUsage === undefined) return 0
  let total = 0
  for (const row of Object.values(modelUsage)) {
    const requests = record(row)?.webSearchRequests
    if (typeof requests === 'number' && Number.isFinite(requests) && requests > 0) total += requests
  }
  return total
}

interface SearchEventState {
  sawNativeSearch: boolean
  initTools: string[] | undefined
  unexpectedTools: string[]
  result: Record<string, unknown> | undefined
}

function contentBlocks(event: Record<string, unknown>): Record<string, unknown>[] {
  const message = record(event.message)
  const content = message?.content ?? event.content
  if (!Array.isArray(content)) return []
  const blocks: Record<string, unknown>[] = []
  for (const block of content) {
    const rec = record(block)
    if (rec !== undefined) blocks.push(rec)
  }
  return blocks
}

function consumeSearchEvent(state: SearchEventState, raw: unknown): void {
  const event = record(raw)
  if (event === undefined) return

  if (event.type === 'error') {
    throw new GrokWebSearchBackendError(
      'WEB_SEARCH_PROVIDER_ERROR',
      `Grok native web_search emitted an error: ${bounded(event.message)}`,
    )
  }

  if (event.type === 'system' && event.subtype === 'init') {
    if (Array.isArray(event.tools)) {
      state.initTools = event.tools.filter((name): name is string => typeof name === 'string')
    }
    return
  }

  if (event.type === 'tool_call' && typeof event.toolName === 'string') {
    if (event.toolName === SEARCH_TOOL_NAME) state.sawNativeSearch = true
    else state.unexpectedTools.push(event.toolName)
    return
  }

  if (event.type === 'assistant') {
    for (const block of contentBlocks(event)) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        if (block.name === SEARCH_TOOL_NAME) state.sawNativeSearch = true
        else state.unexpectedTools.push(block.name)
      }
      if (block.type === 'server_tool_use' && block.name === SEARCH_TOOL_NAME) {
        state.sawNativeSearch = true
      }
      if (block.type === 'web_search_tool_result') state.sawNativeSearch = true
    }
    return
  }

  if (event.type === 'user') {
    for (const block of contentBlocks(event)) {
      if (block.type === 'tool_result' && isWebSearchToolResult(block.content)) {
        state.sawNativeSearch = true
      }
    }
    return
  }

  if (event.type === 'result') {
    state.result = event
    if (webSearchRequestCount(event) > 0) state.sawNativeSearch = true
  }
}

function addNativeSource(
  sources: { url: string; title: string; snippet: string; publishedAt: string }[],
  seen: Set<string>,
  url: string,
  title = '',
  snippet = '',
): void {
  if (url.length === 0 || seen.has(url)) return
  seen.add(url)
  sources.push({ url, title, snippet, publishedAt: '' })
}

/** URLs actually observed on the native search path, not the model's paraphrase. */
function nativeSources(events: readonly unknown[]): { url: string; title: string; snippet: string; publishedAt: string }[] {
  const sources: { url: string; title: string; snippet: string; publishedAt: string }[] = []
  const seen = new Set<string>()
  for (const raw of events) {
    const event = record(raw)
    if (event === undefined) continue
    if (event.type === 'user') {
      for (const block of contentBlocks(event)) {
        if (block.type !== 'tool_result' || typeof block.content !== 'string') continue
        try {
          const parsed = record(JSON.parse(block.content) as unknown)
          if (parsed?.type !== 'WebSearch' || !Array.isArray(parsed.citations)) continue
          for (const citation of parsed.citations) {
            if (typeof citation === 'string') addNativeSource(sources, seen, citation)
          }
        } catch {
          // Not a WebSearch tool result.
        }
      }
    }
    if (event.type === 'assistant') {
      for (const block of contentBlocks(event)) {
        if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
        for (const hit of block.content) {
          const rec = record(hit)
          if (typeof rec?.url !== 'string') continue
          addNativeSource(
            sources,
            seen,
            rec.url,
            typeof rec.title === 'string' ? rec.title : '',
          )
        }
      }
    }
  }
  return sources
}

function structuredFromResult(result: Record<string, unknown>): unknown {
  const structured = result.structured_output ?? result.structuredOutput
  if (record(structured) !== undefined) return structured
  if (typeof structured === 'string' && structured.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(structured)
      if (record(parsed) !== undefined) return parsed
    } catch {
      // Fall through to the reply text.
    }
  }
  if (typeof result.result === 'string' && result.result.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(result.result)
      if (record(parsed) !== undefined && Array.isArray(record(parsed)?.sources)) return parsed
    } catch {
      // Not a source.
    }
  }
  return undefined
}

/**
 * Validate a Grok Messages-stream search turn and return only a
 * native-search-backed structured answer.
 *
 * Client-side `web_search` does not increment `server_tool_use.web_search_requests`
 * (measured 0 on a successful client search). Native search is proven by the
 * `tool_use` / `WebSearch` tool result / inline `server_tool_use` blocks, not
 * by that counter.
 */
export function grokSearchResultFromEvents(events: readonly unknown[]): unknown {
  if (events.length === 1) {
    const only = record(events[0])
    if (
      only !== undefined
      && only.type !== 'system'
      && only.type !== 'assistant'
      && only.type !== 'user'
      && only.type !== 'result'
      && only.type !== 'tool_call'
    ) {
      throw protocol(
        'Grok web_search returned a json envelope rather than the Messages stream this backend reads; client-side web_search does not increment server_tool_use.web_search_requests, so native search cannot be proven from that envelope',
      )
    }
  }

  const state: SearchEventState = {
    sawNativeSearch: false,
    initTools: undefined,
    unexpectedTools: [],
    result: undefined,
  }
  for (const event of events) consumeSearchEvent(state, event)

  if (state.initTools !== undefined) {
    const unexpected = state.initTools.filter(name => !SEARCH_INIT_ALLOWLIST.has(name))
    if (unexpected.length > 0) {
      throw protocol(`Grok hidden search turn advertised unexpected built-in(s): ${unexpected.join(', ')}`)
    }
    if (!state.initTools.includes(SEARCH_TOOL_NAME)) {
      throw protocol('Grok hidden search turn init.tools did not include web_search')
    }
  }

  if (state.unexpectedTools.length > 0) {
    throw protocol(`Grok hidden search turn invoked unexpected native tool(s): ${state.unexpectedTools.join(', ')}`)
  }
  if (!state.sawNativeSearch) {
    throw protocol('Grok model completed the hidden search turn without web_search')
  }
  if (state.result === undefined) {
    throw protocol('Grok native web_search ended without a result line')
  }
  if (state.result.is_error === true || (typeof state.result.subtype === 'string' && state.result.subtype.startsWith('error'))) {
    throw new GrokWebSearchBackendError(
      'WEB_SEARCH_PROVIDER_ERROR',
      `Grok native web_search failed (${bounded(state.result.subtype ?? 'error')})`,
    )
  }

  const structured = structuredFromResult(state.result)
  if (structured === undefined) {
    throw protocol('Grok native web_search returned no structured output')
  }
  const row = record(structured)
  if (row !== undefined && Array.isArray(row.sources) && row.sources.length === 0) {
    const observed = nativeSources(events)
    if (observed.length > 0) return { ...row, sources: observed }
  }
  return structured
}

/** Parse the Messages-stream stdout of one hidden search turn. */
export function parseSearchStdout(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    throw protocol('Grok web_search produced no output')
  }
  const events: unknown[] = []
  for (const line of trimmed.split('\n')) {
    const row = line.trim()
    if (row.length === 0) continue
    try {
      events.push(JSON.parse(row) as unknown)
    } catch (error) {
      throw protocol(`Grok web_search emitted a non-JSON Messages line: ${bounded(row)}`, error)
    }
  }
  return grokSearchResultFromEvents(events)
}

function searchFailure(
  error: unknown,
  parentSignal: AbortSignal,
  timeoutSignal: AbortSignal,
  timeoutMs: number,
): GrokWebSearchBackendError {
  if (error instanceof GrokWebSearchBackendError) return error
  if (parentSignal.aborted) {
    return new GrokWebSearchBackendError('WEB_SEARCH_ABORTED', 'Grok web_search was aborted', { cause: error })
  }
  if (timeoutSignal.aborted) {
    return new GrokWebSearchBackendError(
      'WEB_SEARCH_PROVIDER_ERROR',
      `Grok web_search timed out after ${timeoutMs}ms`,
      { cause: error },
    )
  }
  if (isArgListTooLong(error)) {
    const failure = grokVendorFailure({ stage: 'web-search', stderrText: undefined, category: 'spawn-too-big' })
    return new GrokWebSearchBackendError(
      'WEB_SEARCH_PROVIDER_ERROR',
      `Grok web_search could not be spawned because the command line was too long. ${failure.message}`,
      { cause: failure },
    )
  }
  return error instanceof Error
    ? new GrokWebSearchBackendError('WEB_SEARCH_PROVIDER_ERROR', error.message, { cause: error })
    : new GrokWebSearchBackendError('WEB_SEARCH_PROVIDER_ERROR', String(error))
}

/** Official Grok `web_search` backend. This class does not register a DSH tool. */
export class GrokSearchBackend {
  constructor(private readonly ctx: Context, private readonly config: GrokSearchBackendConfig) {}

  async search(_route: GrokSearchRoute, request: GrokSearchRequest, parentSignal: AbortSignal): Promise<unknown> {
    const workdir = await mkdtemp(join(tmpdir(), 'dsh-web-search-grok-'))
    const promptPath = join(workdir, 'prompt.json')
    try {
      const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs)
      const signal = AbortSignal.any([parentSignal, timeoutSignal])
      await writeFile(promptPath, promptFileBody(promptFor(request.query, request.maxResults)), 'utf8')

      const args = headlessSearchArgv({
        promptFile: promptPath,
        schemaJson: JSON.stringify(SEARCH_OUTPUT_SCHEMA),
        model: SEARCH_MODEL,
        effort: SEARCH_EFFORT,
        system: searchSystemPrompt(),
        sessionId: randomUUID(),
        turnCap: SEARCH_VENDOR_TURN_CAP,
      })

      let invocation: VendorInvocation
      try {
        invocation = await this.invocation(args, signal)
      } catch (error) {
        throw searchFailure(error, parentSignal, timeoutSignal, this.config.timeoutMs)
      }

      let child: SubprocessHandle | undefined
      try {
        child = this.ctx.subprocess.spawn({
          argv: [...invocation.argv],
          cwd: workdir,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_STDOUT_BYTES },
            stderr: { maxBytes: this.config.stderrMaxBytes },
          },
          graceMs: this.config.disposeGraceMs,
          signal,
          env: { ...invocation.env },
        })
      } catch (error) {
        throw searchFailure(error, parentSignal, timeoutSignal, this.config.timeoutMs)
      }

      let opError: GrokWebSearchBackendError | undefined
      let result: unknown
      try {
        const outcome = await child.done
        const stdout = child.collected.stdout?.readFrom(0).text ?? ''
        const stderr = child.collected.stderr?.readFrom(0).text ?? ''
        if (signal.aborted) {
          throw searchFailure(undefined, parentSignal, timeoutSignal, this.config.timeoutMs)
        }
        if (stdout.trim().length === 0) {
          const failure = grokVendorFailure({
            stage: 'web-search',
            stderrText: stderr,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
          })
          throw new GrokWebSearchBackendError(
            'WEB_SEARCH_PROVIDER_ERROR',
            `Grok web_search exited before a Messages stream. ${failure.message}`,
            { cause: failure },
          )
        }
        result = parseSearchStdout(stdout)
      } catch (error) {
        opError = searchFailure(error, parentSignal, timeoutSignal, this.config.timeoutMs)
      }

      try {
        await disposeVendorChild(child)
      } catch (cleanupErrorRaw) {
        const cleanupError = new GrokWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Grok web_search subprocess cleanup failed: ${bounded(cleanupErrorRaw)}`,
          { cause: cleanupErrorRaw },
        )
        if (opError !== undefined) {
          throw new GrokWebSearchBackendError(
            opError.code,
            `${opError.message} (subprocess cleanup also failed: ${bounded(cleanupErrorRaw)})`,
            {
              cause: new AggregateError(
                [opError, cleanupError],
                'Grok web_search failed and subprocess cleanup also failed',
              ),
            },
          )
        }
        throw cleanupError
      }

      if (opError !== undefined) throw opError
      return result
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {})
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
