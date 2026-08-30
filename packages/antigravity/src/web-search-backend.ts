import { createInterface } from 'node:readline'
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { ephemeralAgentWorkspace } from 'nishi-dsh-core/runtime'
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

interface Invocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

interface AgyResult {
  readonly status?: unknown
  readonly response?: unknown
  readonly error?: unknown
  readonly structured_output?: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
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

function nativeToolNames(events: readonly Record<string, unknown>[]): string[] {
  const names: string[] = []
  for (const event of events) {
    const step = record(event.step_update) ?? event
    if (step.step_type !== 'tool') continue
    const toolInfo = record(step.tool_info)
    const name = step.tool_name ?? toolInfo?.tool_name ?? toolInfo?.name
    if (typeof name === 'string') names.push(name)
  }
  return names
}

function structuredResult(result: AgyResult): unknown {
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
      const child = this.ctx.subprocess.spawn({
        argv: [...invocation.argv],
        cwd: root,
        stdio: {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: { maxBytes: this.config.stderrMaxBytes },
        },
        graceMs: this.config.disposeGraceMs,
        signal,
        env: { ...invocation.env },
      })

      try {
        const stdin = child.stdin
        const stdout = child.stdout
        if (!stdin || !stdout) {
          throw new AntigravityWebSearchBackendError('WEB_SEARCH_PROVIDER_ERROR', 'Antigravity web_search subprocess did not expose required stdio pipes')
        }
        stdin.on('error', () => {})
        stdout.on('error', () => {})
        stdout.setEncoding('utf8')
        const lines = createInterface({ input: stdout, crlfDelay: Infinity })
        const events: Record<string, unknown>[] = []
        const resultPromise = new Promise<AgyResult>((resolve, reject) => {
          let settled = false
          const fail = (error: unknown): void => {
            if (settled) return
            settled = true
            reject(error)
          }
          const onAbort = (): void => {
            if (parentSignal.aborted) {
              fail(new AntigravityWebSearchBackendError('WEB_SEARCH_ABORTED', 'Antigravity web_search was aborted'))
            } else {
              fail(new AntigravityWebSearchBackendError('WEB_SEARCH_PROVIDER_ERROR', `Antigravity web_search timed out after ${this.config.timeoutMs}ms`))
            }
          }
          signal.addEventListener('abort', onAbort, { once: true })
          lines.on('line', (line) => {
            const trimmed = line.trim()
            if (!trimmed) return
            let parsed: unknown
            try {
              parsed = JSON.parse(trimmed) as unknown
            } catch (error) {
              fail(new AntigravityWebSearchBackendError('WEB_SEARCH_PROTOCOL', `Antigravity emitted non-JSON stdout in stream-json mode: ${bounded(trimmed)}`, { cause: error }))
              return
            }
            const event = record(parsed)
            if (!event) return
            events.push(event)
            if (event.event !== 'result') return
            const result = (record(event.result) ?? {}) as AgyResult
            if (!settled) {
              settled = true
              signal.removeEventListener('abort', onAbort)
              resolve(result)
            }
          })
          lines.on('close', () => {
            if (settled) return
            void child.done.then((outcome) => {
              if (settled) return
              const stderr = child.collected.stderr?.readFrom(0).text ?? ''
              const failure = antigravityVendorFailure({
                stage: 'web-search-exit',
                stderrText: stderr,
                exitCode: outcome.exitCode,
                signal: outcome.signal,
              })
              fail(new AntigravityWebSearchBackendError(
                'WEB_SEARCH_PROVIDER_ERROR',
                `Antigravity web_search exited before a result event. ${failure.message}`,
                { cause: failure },
              ))
            }).catch(fail)
          })
        })
        resultPromise.catch(() => {})

        stdin.write(`${JSON.stringify({ event: 'user', message: { content: promptFor(request.query) } })}\n`)
        const result = await resultPromise
        try { stdin.end() } catch {}

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
        const tools = nativeToolNames(events)
        if (!tools.includes('search_web')) {
          throw new AntigravityWebSearchBackendError('WEB_SEARCH_PROTOCOL', `Antigravity model ${JSON.stringify(route.model)} completed the hidden search turn without search_web`)
        }
        const unexpected = tools.filter(name => name !== 'search_web' && name !== 'finish')
        if (unexpected.length > 0) {
          throw new AntigravityWebSearchBackendError('WEB_SEARCH_PROTOCOL', `Antigravity hidden search turn invoked unexpected native tool(s): ${unexpected.join(', ')}`)
        }
        return structuredResult(result)
      } finally {
        child.terminate()
        await child.waitForExit(AbortSignal.timeout(this.config.disposeGraceMs)).catch(() => false)
      }
    } finally {
      await workspace.dispose()
    }
  }

  private async invocation(args: readonly string[], signal: AbortSignal): Promise<Invocation> {
    const executable = await this.ctx.subprocess.resolveExecutable(this.config.executable, { ...this.config.env }, signal)
    const extension = extname(executable).toLowerCase()
    if (process.platform !== 'win32' || (extension !== '.cmd' && extension !== '.bat')) {
      return { argv: [executable, ...args], env: this.config.env }
    }
    const cmd = await this.ctx.subprocess.resolveExecutable('cmd.exe', { ...this.config.env }, signal)
    return {
      argv: [cmd, '/d', '/v:off', '/s', '/c', `%${WINDOWS_EXECUTABLE_ENV}%`, ...args],
      env: { ...this.config.env, [WINDOWS_EXECUTABLE_ENV]: `"${executable}"` },
    }
  }
}
