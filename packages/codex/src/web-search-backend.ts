import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { resolveCodexExecutable } from './resolver.js'

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

export interface CodexSearchExecSpec {
  readonly executable: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly cwd: string
  readonly schemaPath: string
  readonly prompt: string
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

const DISPOSE_GRACE_MS = 2_000
const STDERR_MAX_BYTES = 64_000

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

function promptFor(query: string, maxResults: number): string {
  return [
    'Use the native web search tool to search the public web for the query below.',
    'Do not run shell commands, inspect local files, use MCP, or answer from memory alone.',
    'Return only URLs that were actually observed in native web-search results.',
    `Return at most ${maxResults} sources.`,
    'For each source provide its URL and, when available, title, a short useful snippet, and publication date.',
    'If a field is unavailable return an empty string for that field.',
    'Provide a concise content summary grounded only in those search results; use an empty string if no result supports a summary.',
    '',
    `Query: ${query}`,
  ].join('\n')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Build the isolated external `codex exec` invocation used only for native web search. */
export function codexSearchExecArgv(spec: CodexSearchExecSpec): string[] {
  const inheritedEffort = effort(spec.reasoningEffort)
  return [
    spec.executable,
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--cd', spec.cwd,
    '--json',
    '--output-schema', spec.schemaPath,
    '-m', spec.model,
    ...(inheritedEffort === undefined ? [] : ['-c', `model_reasoning_effort="${inheritedEffort}"`]),
    '-c', 'web_search="live"',
    spec.prompt,
  ]
}

/** Validate Codex exec JSONL events and return only a native-search-backed structured answer. */
export function codexSearchResultFromEvents(events: readonly unknown[]): unknown {
  let sawNativeSearch = false
  let completed = false
  let finalResponse: string | undefined

  for (const raw of events) {
    const event = record(raw)
    if (!event) continue

    if (event.type === 'error') {
      throw new CodexWebSearchBackendError(
        'WEB_SEARCH_PROVIDER_ERROR',
        `Codex native web_search emitted an error: ${boundedError(event.message)}`,
      )
    }
    if (event.type === 'turn.failed') {
      const failure = record(event.error)
      throw new CodexWebSearchBackendError(
        'WEB_SEARCH_PROVIDER_ERROR',
        `Codex native web_search turn failed: ${boundedError(failure?.message ?? event.error)}`,
      )
    }
    if (event.type === 'turn.completed') {
      completed = true
      continue
    }
    if (event.type !== 'item.completed') continue

    const item = record(event.item)
    const itemType = item?.type
    if (itemType === 'web_search') {
      sawNativeSearch = true
      continue
    }
    if (itemType === 'agent_message' && typeof item?.text === 'string') {
      finalResponse = item.text
      continue
    }
    if (itemType === 'error') {
      throw new CodexWebSearchBackendError(
        'WEB_SEARCH_PROVIDER_ERROR',
        `Codex native web_search item failed: ${boundedError(item?.message)}`,
      )
    }
    if (itemType === 'command_execution' || itemType === 'file_change' || itemType === 'mcp_tool_call') {
      throw new CodexWebSearchBackendError(
        'WEB_SEARCH_PROTOCOL',
        `Codex hidden search turn invoked unexpected local tool item ${itemType}`,
      )
    }
  }

  if (!completed) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      'Codex native web_search ended without turn.completed',
    )
  }
  if (!sawNativeSearch) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      'Codex hidden search turn completed without a native web_search item',
    )
  }
  if (finalResponse === undefined || finalResponse.trim().length === 0) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      'Codex native web_search returned empty structured output',
    )
  }
  try {
    return JSON.parse(finalResponse) as unknown
  } catch (error) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      `Codex native web_search returned invalid structured JSON: ${boundedError(error)}`,
      { cause: error },
    )
  }
}

/** Codex-native web search backend using the already-installed external Codex CLI. */
export class CodexSearchBackend {
  constructor(private readonly ctx: Context) {}

  async search(route: CodexSearchRoute, request: CodexSearchRequest, signal: AbortSignal): Promise<unknown> {
    const workdir = await mkdtemp(join(tmpdir(), 'dsh-web-search-codex-'))
    const schemaPath = join(workdir, 'search-output.schema.json')
    try {
      await writeFile(schemaPath, JSON.stringify(SEARCH_OUTPUT_SCHEMA), 'utf8')

      let executable: string
      try {
        executable = resolveCodexExecutable({ env: process.env }).executable
      } catch (error) {
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex CLI is unavailable for native web_search: ${boundedError(error)}`,
          { cause: error },
        )
      }

      const argv = codexSearchExecArgv({
        executable,
        model: route.model,
        reasoningEffort: route.reasoningEffort,
        cwd: workdir,
        schemaPath,
        prompt: promptFor(request.query, request.maxResults),
      })

      let child
      try {
        child = this.ctx.subprocess.spawn({
          argv,
          cwd: workdir,
          stdio: {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: { maxBytes: STDERR_MAX_BYTES },
          },
          graceMs: DISPOSE_GRACE_MS,
          signal,
          env: {},
        })
      } catch (error) {
        if (signal.aborted) {
          throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted', { cause: error })
        }
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex native web_search failed to start: ${boundedError(error)}`,
          { cause: error },
        )
      }

      child.done.catch(() => {})
      try {
        const stdout = child.stdout
        if (!stdout) {
          throw new CodexWebSearchBackendError(
            'WEB_SEARCH_PROVIDER_ERROR',
            'Codex web_search subprocess did not expose stdout',
          )
        }
        try { child.stdin?.end() } catch {}
        stdout.setEncoding('utf8')
        const lines = createInterface({ input: stdout, crlfDelay: Infinity })
        const events: unknown[] = []
        let terminal = false
        try {
          for await (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            let parsed: unknown
            try {
              parsed = JSON.parse(trimmed) as unknown
            } catch (error) {
              throw new CodexWebSearchBackendError(
                'WEB_SEARCH_PROTOCOL',
                `Codex emitted non-JSON stdout in --json mode: ${boundedError(trimmed)}`,
                { cause: error },
              )
            }
            events.push(parsed)
            if (record(parsed)?.type === 'turn.completed') {
              terminal = true
              break
            }
            if (record(parsed)?.type === 'turn.failed' || record(parsed)?.type === 'error') {
              terminal = true
              break
            }
          }
        } finally {
          lines.close()
        }

        if (!terminal) {
          const outcome = await child.done
          const stderr = child.collected.stderr?.readFrom(0).text ?? ''
          if (signal.aborted) {
            throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted')
          }
          throw new CodexWebSearchBackendError(
            'WEB_SEARCH_PROVIDER_ERROR',
            `Codex web_search exited before a terminal event (exit ${String(outcome.exitCode)})${stderr ? `: ${boundedError(stderr)}` : ''}`,
          )
        }

        return codexSearchResultFromEvents(events)
      } catch (error) {
        if (error instanceof CodexWebSearchBackendError) throw error
        if (signal.aborted) {
          throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted', { cause: error })
        }
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex native web_search failed for model ${JSON.stringify(route.model)}: ${boundedError(error)}`,
          { cause: error },
        )
      } finally {
        child.terminate()
        await child.waitForExit(AbortSignal.timeout(DISPOSE_GRACE_MS)).catch(() => false)
      }
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
