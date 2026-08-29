import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { disposeVendorChild, outputLines } from 'nishi-dsh-core/runtime'
import { codexAppServerInvocation, codexWindowsBatchShimInvocation } from './codex-plugin-dsh/adapter.js'
import { CodexAppServerConnection } from './codex-plugin-dsh/app-server.js'
import { codexVendorFailure } from './codex-plugin-dsh/vendor-stderr.js'

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

export interface CodexSearchBackendConfig {
  readonly executable?: string
  readonly env?: Readonly<Record<string, string>>
}

interface CodexSearchEventState {
  sawNativeSearch: boolean
  completed: boolean
  finalResponse?: string
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
const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024
const PREFLIGHT_TIMEOUT_MS = 30_000
const WINDOWS_EXEC_PROMPT_ENV = 'DSH_CODEX_EXEC_PROMPT'

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length <= 2_000 ? text : `${text.slice(0, 2_000)}…`
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`Codex web_search operation aborted: ${String(signal.reason)}`)
}

/**
 * Race a shared, provider-owned promise against one caller's own signal so a
 * caller's cancellation rejects only that caller and never aborts (or is
 * mistaken for a failure of) work shared with other concurrent callers.
 */
async function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([promise, aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
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

/**
 * Encode a user web query as a JSON string literal while removing literal `$`
 * sigils from the raw Codex prompt. Codex v0.150 scans raw text for `$name`
 * before model execution and treats those sequences as explicit host-skill
 * mentions. JSON `\u0024` decodes back to the exact query for the model while
 * remaining invisible to that pre-model mention parser.
 */
export function codexSearchQueryLiteral(query: string): string {
  return JSON.stringify(query).replaceAll('$', '\\u0024')
}

function promptFor(query: string, maxResults: number): string {
  return [
    'Use the native web search tool to search the public web for the query below.',
    'Do not run shell commands, inspect local files, use MCP, skills, apps, plugins, image generation, or answer from memory alone.',
    'Return only URLs that were actually observed in native web-search results.',
    `Return at most ${maxResults} sources.`,
    'For each source provide its URL and, when available, title, a short useful snippet, and publication date.',
    'If a field is unavailable return an empty string for that field.',
    'Provide a concise content summary grounded only in those search results; use an empty string if no result supports a summary.',
    'The query is supplied as a JSON string literal. Decode JSON escapes before searching and preserve the decoded text exactly.',
    '',
    `Query JSON string: ${codexSearchQueryLiteral(query)}`,
  ].join('\n')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Fixed, developer-authored `codex exec` argv between the executable and the trailing prompt. */
function codexSearchExecFixedArgs(spec: Omit<CodexSearchExecSpec, 'executable' | 'prompt'>): string[] {
  const inheritedEffort = effort(spec.reasoningEffort)
  return [
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
    '-c', 'approval_policy="never"',
    '-c', 'features.shell_tool=false',
    '-c', 'features.unified_exec=false',
    '-c', 'features.shell_zsh_fork=false',
    '-c', 'features.shell_snapshot=false',
    '-c', 'features.shell_snapshot_v2=false',
    '-c', 'features.exec_permission_approvals=false',
    '-c', 'features.request_permissions_tool=false',
    '-c', 'features.multi_agent=false',
    '-c', 'features.multi_agent_v2=false',
    '-c', 'features.code_mode=false',
    '-c', 'features.memories=false',
    '-c', 'features.external_agent_memory_import=false',
    '-c', 'features.chronicle=false',
    '-c', 'features.view_image=false',
    '-c', 'features.hooks=false',
    '-c', 'features.goals=false',
    '-c', 'features.token_budget=false',
    '-c', 'features.rollout_budget=false',
    '-c', 'features.current_time_reminder=false',
    '-c', 'features.skill_search=false',
    '-c', 'features.skill_mcp_dependency_install=false',
    '-c', 'features.deferred_executor=false',
    '-c', 'features.executor_capability_discovery=false',
    '-c', 'features.apps=false',
    '-c', 'features.enable_mcp_apps=false',
    '-c', 'features.plugins=false',
    '-c', 'features.recommended_plugins=false',
    '-c', 'features.tool_suggest=false',
    '-c', 'features.remote_plugin=false',
    '-c', 'features.plugin_sharing=false',
    '-c', 'features.browser_use=false',
    '-c', 'features.browser_use_full_cdp_access=false',
    '-c', 'features.browser_use_external=false',
    '-c', 'features.computer_use=false',
    '-c', 'features.in_app_browser=false',
    '-c', 'features.in_app_chat=false',
    '-c', 'features.in_app_dictation=false',
    '-c', 'features.in_app_local_automation=false',
    '-c', 'features.in_app_updates=false',
    '-c', 'features.network_proxy=false',
    '-c', 'features.unbounded_connection_retries=false',
    '-c', 'features.guardian_approval=false',
    '-c', 'features.guardianv2=false',
    '-c', 'features.guardian_ext=false',
    '-c', 'features.tool_call_mcp_elicitation=false',
    '-c', 'features.auth_elicitation=false',
    '-c', 'features.artifact=false',
    '-c', 'features.image_generation=false',
    '-c', 'features.workspace_dependencies=false',
    '-c', 'features.prevent_idle_sleep=false',
    '-c', 'agents.enabled=false',
    '-c', 'tools.experimental_request_user_input.enabled=false',
    '-c', 'tools.update_plan.enabled=false',
    '-c', 'orchestrator.skills.enabled=false',
    '-c', 'orchestrator.mcp.enabled=false',
    '-c', 'skills.bundled.enabled=false',
    '-c', 'skills.include_instructions=false',
    '-c', 'notify=[]',
    '-c', 'include_permissions_instructions=false',
    '-c', 'include_apps_instructions=false',
    '-c', 'include_collaboration_mode_instructions=false',
    '-c', 'include_environment_context=false',
    '-c', 'allow_login_shell=false',
    '-c', 'memories.use_memories=false',
    '-c', 'memories.generate_memories=false',
    '-c', 'project_doc_max_bytes=0',
    '-c', 'web_search="live"',
  ]
}

/** Build the isolated external `codex exec` invocation used only for native web search. */
export function codexSearchExecArgv(spec: CodexSearchExecSpec): string[] {
  return [spec.executable, ...codexSearchExecFixedArgs(spec), spec.prompt]
}

/**
 * Build the `codex exec` invocation for native web search, routing it
 * through the same Windows batch-shim indirection as the App Server so a
 * `.cmd`/`.bat` executable and its long, model-authored prompt tail never
 * enter a parsed `cmd.exe` command line directly.
 */
export function codexSearchExecInvocation(
  spec: CodexSearchExecSpec,
  env: Readonly<Record<string, string>>,
  platform: NodeJS.Platform = process.platform,
  commandInterpreter = 'cmd.exe',
): { readonly argv: readonly string[]; readonly env: Readonly<Record<string, string>> } {
  const extension = extname(spec.executable).toLowerCase()
  if (platform !== 'win32' || (extension !== '.cmd' && extension !== '.bat')) {
    return { argv: codexSearchExecArgv(spec), env }
  }
  return codexWindowsBatchShimInvocation(spec.executable, env, commandInterpreter, codexSearchExecFixedArgs(spec), {
    envKey: WINDOWS_EXEC_PROMPT_ENV,
    value: spec.prompt,
  })
}

function consumeCodexSearchEvent(state: CodexSearchEventState, raw: unknown): boolean {
  const event = record(raw)
  if (!event) return false

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
    state.completed = true
    return true
  }
  if (event.type !== 'item.completed') return false

  const item = record(event.item)
  const itemType = item?.type
  if (itemType === 'web_search') {
    state.sawNativeSearch = true
    return false
  }
  if (itemType === 'agent_message' && typeof item?.text === 'string') {
    state.finalResponse = item.text
    return false
  }
  if (itemType === 'reasoning') return false
  if (itemType === 'error') {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROVIDER_ERROR',
      `Codex native web_search item failed: ${boundedError(item?.message)}`,
    )
  }
  throw new CodexWebSearchBackendError(
    'WEB_SEARCH_PROTOCOL',
    `Codex hidden search turn emitted unexpected completed item ${String(itemType)}`,
  )
}

function finishCodexSearchResult(state: CodexSearchEventState): unknown {
  if (!state.completed) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      'Codex native web_search ended without turn.completed',
    )
  }
  if (!state.sawNativeSearch) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      'Codex hidden search turn completed without a native web_search item',
    )
  }
  if (state.finalResponse === undefined || state.finalResponse.trim().length === 0) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      'Codex native web_search returned empty structured output',
    )
  }
  try {
    return JSON.parse(state.finalResponse) as unknown
  } catch (error) {
    throw new CodexWebSearchBackendError(
      'WEB_SEARCH_PROTOCOL',
      `Codex native web_search returned invalid structured JSON: ${boundedError(error)}`,
      { cause: error },
    )
  }
}

/** Validate Codex exec JSONL events and return only a native-search-backed structured answer. */
export function codexSearchResultFromEvents(events: readonly unknown[]): unknown {
  const state: CodexSearchEventState = { sawNativeSearch: false, completed: false }
  for (const event of events) {
    if (consumeCodexSearchEvent(state, event)) break
  }
  return finishCodexSearchResult(state)
}

async function verifyCodexSearchRuntime(
  ctx: Context,
  executable: string,
  env: Readonly<Record<string, string>>,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const batchShim = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())
  const commandInterpreter = batchShim
    ? await ctx.subprocess.resolveExecutable('cmd.exe', env, signal)
    : undefined
  const invocation = codexAppServerInvocation(executable, env, process.platform, commandInterpreter)
  let child: SubprocessHandle | undefined
  let connection: CodexAppServerConnection | undefined
  try {
    child = ctx.subprocess.spawn({
      argv: [...invocation.argv],
      cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: DISPOSE_GRACE_MS,
      signal,
      env: invocation.env,
    })
    connection = new CodexAppServerConnection(
      child,
      async method => Promise.reject(new Error(`Codex runtime preflight received unexpected App Server request ${method}`)),
    )
    await connection.initialize(signal)
  } finally {
    if (connection !== undefined) await connection.close()
    else if (child !== undefined) await disposeVendorChild(child)
  }
}

/** Codex-native web search backend using the already-installed external Codex CLI. */
export class CodexSearchBackend {
  private readonly config: { readonly executable: string; readonly env: Readonly<Record<string, string>> }
  private verifiedExecutable: string | undefined
  private pendingVerification: { readonly executable: string; readonly promise: Promise<void> } | undefined

  constructor(
    private readonly ctx: Context,
    config: CodexSearchBackendConfig = {},
  ) {
    this.config = {
      executable: config.executable?.trim() || 'codex',
      env: { ...config.env },
    }
  }

  /**
   * Verify the resolved Codex runtime once per resolved executable path,
   * sharing one in-flight preflight across concurrent `search()` calls
   * instead of spawning an App Server per query (a single `web_search` tool
   * call can run up to 4 concurrent queries). A failed preflight is never
   * cached as success, so the next call retries it; a resolved executable
   * path change invalidates the cache. One caller's own cancellation only
   * rejects that caller and never aborts (or is mistaken for a failure of)
   * the shared check other concurrent callers are waiting on.
   */
  private async ensureVerifiedRuntime(executable: string, signal: AbortSignal): Promise<void> {
    if (this.verifiedExecutable === executable) return
    let pending = this.pendingVerification
    if (pending === undefined || pending.executable !== executable) {
      let created!: Promise<void>
      created = (async (): Promise<void> => {
        const workdir = await mkdtemp(join(tmpdir(), 'dsh-web-search-codex-preflight-'))
        try {
          await verifyCodexSearchRuntime(
            this.ctx,
            executable,
            this.config.env,
            workdir,
            AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
          )
          this.verifiedExecutable = executable
        } finally {
          await rm(workdir, { recursive: true, force: true }).catch(() => {})
          if (this.pendingVerification?.promise === created) this.pendingVerification = undefined
        }
      })()
      pending = { executable, promise: created }
      this.pendingVerification = pending
      void created.catch(() => {})
    }
    return waitForPromise(pending.promise, signal)
  }

  async search(route: CodexSearchRoute, request: CodexSearchRequest, signal: AbortSignal): Promise<unknown> {
    const workdir = await mkdtemp(join(tmpdir(), 'dsh-web-search-codex-'))
    const schemaPath = join(workdir, 'search-output.schema.json')
    try {
      await writeFile(schemaPath, JSON.stringify(SEARCH_OUTPUT_SCHEMA), 'utf8')

      let executable: string
      try {
        executable = await this.ctx.subprocess.resolveExecutable(this.config.executable, this.config.env, signal)
      } catch (error) {
        if (signal.aborted) {
          throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted', { cause: error })
        }
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex CLI is unavailable for native web_search: ${boundedError(error)}`,
          { cause: error },
        )
      }

      try {
        await this.ensureVerifiedRuntime(executable, signal)
      } catch (error) {
        if (signal.aborted) {
          throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted', { cause: error })
        }
        throw new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex runtime is incompatible with native web_search: ${boundedError(error)}`,
          { cause: error },
        )
      }

      const batchShim = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())
      const commandInterpreter = batchShim
        ? await this.ctx.subprocess.resolveExecutable('cmd.exe', this.config.env, signal)
        : undefined
      const invocation = codexSearchExecInvocation({
        executable,
        model: route.model,
        reasoningEffort: route.reasoningEffort,
        cwd: workdir,
        schemaPath,
        prompt: promptFor(request.query, request.maxResults),
      }, this.config.env, process.platform, commandInterpreter)

      let child
      try {
        child = this.ctx.subprocess.spawn({
          argv: [...invocation.argv],
          cwd: workdir,
          stdio: {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: { maxBytes: STDERR_MAX_BYTES },
          },
          graceMs: DISPOSE_GRACE_MS,
          signal,
          env: invocation.env,
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
      let opError: unknown
      let result: unknown
      try {
        const stdout = child.stdout
        if (!stdout) {
          throw new CodexWebSearchBackendError(
            'WEB_SEARCH_PROVIDER_ERROR',
            'Codex web_search subprocess did not expose stdout',
          )
        }

        const state: CodexSearchEventState = { sawNativeSearch: false, completed: false }
        let terminal = false
        try {
          for await (const line of outputLines(stdout, MAX_PROTOCOL_LINE_BYTES)) {
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
            terminal = consumeCodexSearchEvent(state, parsed)
            if (terminal) break
          }
        } catch (error) {
          if (error instanceof CodexWebSearchBackendError) throw error
          throw new CodexWebSearchBackendError(
            'WEB_SEARCH_PROTOCOL',
            `Codex emitted invalid bounded JSONL in --json mode: ${boundedError(error)}`,
            { cause: error },
          )
        }

        if (!terminal) {
          const outcome = await child.done
          if (signal.aborted) {
            throw new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted')
          }
          const failure = codexVendorFailure({
            stage: 'web-search',
            stderrText: child.collected.stderr?.readFrom(0).text,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
          })
          throw new CodexWebSearchBackendError(
            'WEB_SEARCH_PROVIDER_ERROR',
            `Codex web_search exited before a terminal event. ${failure.message}`,
            { cause: failure },
          )
        }

        result = finishCodexSearchResult(state)
      } catch (error) {
        opError = error instanceof CodexWebSearchBackendError
          ? error
          : signal.aborted
            ? new CodexWebSearchBackendError('WEB_SEARCH_ABORTED', 'Codex web_search was aborted', { cause: error })
            : new CodexWebSearchBackendError(
              'WEB_SEARCH_PROVIDER_ERROR',
              `Codex native web_search failed for model ${JSON.stringify(route.model)}: ${boundedError(error)}`,
              { cause: error },
            )
      }

      // Cleanup runs regardless of the outcome above, but a cleanup failure
      // must never silently replace a real operation failure: report both
      // (reachable via AggregateError.errors) while keeping the outer error's
      // taxonomy code the one core routes on.
      try {
        await disposeVendorChild(child)
      } catch (cleanupErrorRaw) {
        const cleanupError = new CodexWebSearchBackendError(
          'WEB_SEARCH_PROVIDER_ERROR',
          `Codex web_search subprocess cleanup failed: ${boundedError(cleanupErrorRaw)}`,
          { cause: cleanupErrorRaw },
        )
        if (opError instanceof CodexWebSearchBackendError) {
          throw new CodexWebSearchBackendError(
            opError.code,
            `${opError.message} (subprocess cleanup also failed: ${boundedError(cleanupErrorRaw)})`,
            {
              cause: new AggregateError(
                [opError, cleanupError],
                'Codex web_search failed and subprocess cleanup also failed',
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
}
