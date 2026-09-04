/**
 * Codex App Server implementation of the DeepSeek Harness LLM adapter API.
 *
 * Custom Policy Delta (Nishi DSH Suite):
 * Injects three exact configuration overrides into the external Codex
 * app-server invocation, so the primary plane runs with the vendor's own
 * memory and project-doc injection off and DSH project memory is the only
 * durable memory a turn sees:
 * - -c memories.use_memories=false
 * - -c memories.generate_memories=false
 * - -c project_doc_max_bytes=0
 */

import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  ToolCallId,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type ContentBlock,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type Message,
  type ModelModality,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import {
  CodexAppServerConnection,
  type AppServerConnectionObserver,
  type AppServerNotification,
} from './app-server.js'
import {
  codexDecisionDigest,
  codexHistoryDigest,
  prepareCodexHistory,
  type CodexImageUrlResolver,
  type CodexReplayState,
} from './history.js'
import { codexVendorFailure } from './vendor-stderr.js'
import { attachmentDataUrl, generatedImageBlock } from './images.js'
import {
  codexDecision,
  codexOutputSchema,
  type CodexDecision,
} from './stepped-schema.js'
import { projectCodexPrimaryHistory } from '../primary-history.js'
import { object, optionalObject, string, thrown } from './validation.js'

/** Provider route registered in the existing DSH model catalog. */
export const CODEX_APP_SERVER_PROVIDER = 'codex-app-server'

/** Provider instructions for Codex structured output decisions. */
export const CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS = [
  'DeepSeek Harness owns tool selection, permission checks, execution, and the durable tool log.',
  'Your reply is the required decision: either exactly one tool call or a final message to the user, never both and never more than one call.',
  'DSH executes that decision and places the result in the conversation before the next turn; do not write as though the tool has already run.',
  'For an optional parameter you were not asked to set, pass null rather than inventing a value.',
  'Do not use built-in shell, apply_patch, web search, MCP, app, plugin, multi-agent, or view-image tools.',
  'The skill tool loads only names listed in the DSH <available_skills> catalog included in the conversation; never use it to load Codex host skills or capabilities.',
  'For image creation or editing, use Codex host imagegen and native image generation directly; never call the skill tool with the name imagegen.',
].join(' ')

const WINDOWS_EXECUTABLE_ENV = 'DSH_CODEX_APP_SERVER_EXECUTABLE'

/** Resolved process and timeout configuration owned by the plugin deployment. */
export interface AdapterConfig {
  readonly executable: string
  readonly env: Record<string, string>
  readonly modelCacheMs: number
  readonly catalogTimeoutMs: number
  readonly turnTimeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
  readonly modelPageSize: number
}

interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly defaultReasoningEffort?: string
  readonly supportedReasoningEfforts: readonly {
    readonly id: string
    readonly description?: string
  }[]
  readonly inputModalities: readonly ModelModality[]
}

interface ActiveBlock {
  index: number
  type: 'text' | 'reasoning'
  phase: 'commentary' | 'final_answer' | null
  text: string
  ended: boolean
}

class ActiveTurnQueue {
  private readonly values: AppServerNotification[] = []
  private readonly waiters: Array<PromiseWithResolvers<AppServerNotification>> = []
  private terminal: Error | undefined

  push(notification: AppServerNotification): void {
    if (this.terminal !== undefined) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.values.push(notification)
    else waiter.resolve(notification)
  }

  fail(error: Error): void {
    if (this.terminal !== undefined) return
    this.terminal = error
    this.values.length = 0
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  async next(signal: AbortSignal): Promise<AppServerNotification> {
    signal.throwIfAborted()
    const value = this.values.shift()
    if (value !== undefined) return value
    if (this.terminal !== undefined) throw this.terminal
    const waiter = Promise.withResolvers<AppServerNotification>()
    this.waiters.push(waiter)
    const onAbort = (): void => { waiter.reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await waiter.promise
    } finally {
      signal.removeEventListener('abort', onAbort)
      const index = this.waiters.indexOf(waiter)
      if (index >= 0) this.waiters.splice(index, 1)
    }
  }
}

interface ActiveCodexTurn {
  readonly registryKey: string
  readonly sessionId: string
  readonly model: string
  readonly connection: CodexAppServerConnection
  readonly events: ActiveTurnQueue
  readonly signal: AbortSignal
  readonly step: AbortController
  readonly threadId: string
  readonly turnId: string
  /**
   * Whether this turn was opened with an `outputSchema`, and therefore whether
   * its final message is a decision to parse or ordinary prose.
   *
   * Not the same question as "is this auxiliary". An auxiliary request is
   * deliberately unconstrained, but so is an ordinary request that carries no
   * tools -- `codexOutputSchema` returns nothing for an empty catalog, so the
   * model was never asked for JSON and answering in prose is correct. Gating the
   * decision parse on the auxiliary flag instead failed such a turn with
   * `response is not valid JSON`, which live acceptance caught and no unit test
   * did, because every one of them supplied tools.
   */
  readonly constrained: boolean
  replayState: CodexReplayState
  readonly resolveImageUrl: CodexImageUrlResolver
  readonly onAbort: () => void
  readonly blocks: Map<string, ActiveBlock>
  readonly completedImages: Set<string>
  nextBlockIndex: number
  finalOutput: boolean
  /**
   * How many `error` notifications with `willRetry: true` this turn has
   * ignored **since the vendor last made progress**. The App Server sets that
   * flag for a transient fault it intends to recover from; without a bound the
   * turn sits until `turnTimeoutMs` (ten minutes) and still bills.
   *
   * Counted consecutively rather than cumulatively, and reset by any
   * notification belonging to this turn. A lifetime cap answers the wrong
   * question: a vendor that retries once, streams for a minute, retries again
   * and finishes is healthy, and a cumulative count kills it on the third
   * hiccup of a long turn. What actually indicates a stuck vendor is retrying
   * errors with nothing in between, which is what this measures.
   */
  consecutiveRetryingErrors: number
  usage?: TokenUsage
  closing?: Promise<void>
}

/**
 * Ignore this many retrying App Server errors in a row; the next one fails the
 * turn. Any notification for this turn resets the run, so the bound is on
 * thrashing rather than on a turn's lifetime.
 */
const MAX_CONSECUTIVE_RETRYING_ERRORS = 2

/** Process invocation for one resolved Codex executable. */
export interface CodexAppServerInvocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/**
 * Vendor memory and project-doc suppression for the app-server invocation.
 *
 * Codex reads its own memory store and injects project docs unless told not
 * to, which would put a second durable memory behind the primary route and
 * defeat the one-memory guarantee the Suite exists to provide. These are the
 * only configuration overrides the Suite injects, and they are enforced by
 * the CLI rather than asked of the model.
 */
export const CODEX_MEMORY_POLICY_OVERRIDES: readonly string[] = Object.freeze([
  '-c',
  'memories.use_memories=false',
  '-c',
  'memories.generate_memories=false',
  '-c',
  'project_doc_max_bytes=0',
])

/**
 * One trailing value that must never be spliced directly into a Windows
 * command tail — e.g. a search prompt — routed through its own environment
 * variable placeholder instead, the same way the executable path is.
 */
export interface CodexWindowsShimTrailingArg {
  readonly envKey: string
  readonly value: string
}

/**
 * Wrap a resolved executable and a fixed, developer-authored argv tail
 * behind `cmd.exe /c` indirection for a Windows batch/cmd shim, keeping
 * every piece of configurable/untrusted text — the executable path, and
 * optionally one trailing value such as a prompt — out of the command tail
 * cmd.exe re-parses. Each such value travels through its own environment
 * variable and is referenced in the tail only as a `%VAR%` placeholder, so
 * cmd.exe substitutes it as one token rather than scanning its contents for
 * command syntax.
 * @param executable - Absolute executable path resolved by the DSH subprocess provider.
 * @param env - Explicit child environment from plugin configuration.
 * @param commandInterpreter - Resolved Windows command interpreter.
 * @param fixedTail - Fixed, developer-authored trailing argv, safe to embed in the command tail literally.
 * @param trailingArg - One configurable trailing value carried via its own placeholder, if any.
 * @returns Child argv and environment for the managed subprocess.
 */
export function codexWindowsBatchShimInvocation(
  executable: string,
  env: Readonly<Record<string, string>>,
  commandInterpreter: string,
  fixedTail: readonly string[],
  trailingArg?: CodexWindowsShimTrailingArg,
): CodexAppServerInvocation {
  const shimEnv: Record<string, string> = { ...env, [WINDOWS_EXECUTABLE_ENV]: `"${executable}"` }
  const argv = [commandInterpreter, '/d', '/v:off', '/s', '/c', `%${WINDOWS_EXECUTABLE_ENV}%`, ...fixedTail]
  if (trailingArg !== undefined) {
    shimEnv[trailingArg.envKey] = `"${trailingArg.value}"`
    argv.push(`%${trailingArg.envKey}%`)
  }
  return { argv, env: shimEnv }
}

/**
 * Build the fixed App Server command without allowing configured text into a Windows command tail.
 * @param executable - Absolute executable path resolved by the DSH subprocess provider.
 * @param env - Explicit child environment from plugin configuration.
 * @param platform - Host platform selecting the Windows batch-shim path.
 * @param commandInterpreter - Resolved Windows command interpreter.
 * @returns Child argv and environment for the managed subprocess.
 */
export function codexAppServerInvocation(
  executable: string,
  env: Readonly<Record<string, string>>,
  platform: NodeJS.Platform = process.platform,
  commandInterpreter = 'cmd.exe',
): CodexAppServerInvocation {
  const extension = extname(executable).toLowerCase()
  if (platform !== 'win32' || (extension !== '.cmd' && extension !== '.bat')) {
    return { argv: [executable, ...CODEX_MEMORY_POLICY_OVERRIDES, 'app-server', '--stdio'], env }
  }
  return codexWindowsBatchShimInvocation(executable, env, commandInterpreter, [
    ...CODEX_MEMORY_POLICY_OVERRIDES,
    'app-server',
    '--stdio',
  ])
}

function combinedSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortController {
  // AbortSignal.timeout unrefs its timer, so a wait whose only handle is that
  // signal never fires in a quiet event loop. The turn timeout is the bound
  // on waiting for the vendor; it has to keep the wait alive. Closing the
  // turn aborts this controller so the timer does not outlive the step.
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error(`codex-plugin-dsh: operation timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const stop = (): void => { clearTimeout(timer) }
  controller.signal.addEventListener('abort', stop, { once: true })
  if (parent !== undefined) {
    const onParentAbort = (): void => { controller.abort(abortError(parent)) }
    if (parent.aborted) onParentAbort()
    else {
      parent.addEventListener('abort', onParentAbort, { once: true })
      controller.signal.addEventListener('abort', () => {
        parent.removeEventListener('abort', onParentAbort)
      }, { once: true })
    }
  }
  return controller
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`codex-plugin-dsh: operation aborted: ${String(signal.reason)}`)
}

async function waitForPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
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

function phaseOf(value: unknown): 'commentary' | 'final_answer' | null {
  if (value === undefined || value === null) return null
  if (value === 'commentary' || value === 'final_answer') return value
  throw new Error(`codex-plugin-dsh: App Server returned unknown agent message phase ${JSON.stringify(value)}`)
}

function blockType(phase: 'commentary' | 'final_answer' | null): ActiveBlock['type'] {
  return phase === 'commentary' ? 'reasoning' : 'text'
}

function messageText(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return String(value)
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' ? message : JSON.stringify(value)
}

/**
 * Build a turn-failure diagnostic without copying vendor text into it.
 *
 * `turn.error` is a structured App Server field rather than process stderr,
 * but it is still free text the vendor authored, and it can carry paths or
 * anything else the vendor chose to put there. Every vendor-authored string
 * in this suite goes through `VendorFailure`, including the generic App
 * Server `error` notification's `params.error` handled by
 * {@link notificationFailure} below -- structurally the same free text as
 * `turn.error`, just delivered on a different channel.
 *
 * The cost is accepted: until the recognizer list grows, an ordinary turn
 * failure reports an unrecognized category instead of the vendor's own
 * words. `turn.status` is a safe enum and is still named directly.
 */
function turnFailure(turn: Record<string, unknown>): Error {
  const error = turn.error
  const failure = codexVendorFailure({
    stage: 'turn',
    stderrText: error === undefined || error === null ? undefined : messageText(error),
  })
  return new LlmError(
    `Codex App Server turn ended with status ${String(turn.status)}. ${failure.message}`,
    'CODEX_APP_SERVER',
    { cause: failure },
  )
}

/**
 * Build a fatal-notification failure without copying vendor text into it.
 *
 * Mirrors {@link turnFailure} for the App Server's generic `error`
 * notification: `params.error` is vendor-authored free text exactly like
 * `turn.error`, just arriving as a notification instead of a turn-completed
 * response.
 */
function notificationFailure(error: unknown): Error {
  const failure = codexVendorFailure({
    stage: 'app-server-notification',
    stderrText: error === undefined || error === null ? undefined : messageText(error),
  })
  return new LlmError(
    `Codex App Server reported a fatal error. ${failure.message}`,
    'CODEX_APP_SERVER',
    { cause: failure },
  )
}

function contextWindowExceeded(turn: Record<string, unknown>): boolean {
  if (turn.status !== 'failed' || turn.error === null || typeof turn.error !== 'object' || Array.isArray(turn.error)) return false
  return (turn.error as Record<string, unknown>).codexErrorInfo === 'contextWindowExceeded'
}

/**
 * The vendor's own usable context window for the model this turn ran on, when
 * it discloses one.
 *
 * `thread/tokenUsage/updated` is the ONLY place the App Server publishes this.
 * `model/list` carries no such field, and `config/read` exposes
 * `model_context_window` as the user's OVERRIDE slot, which reads `null` until
 * somebody sets it -- so the figure cannot be had before a turn has run.
 *
 * What arrives is already the USABLE window rather than the model's raw
 * capacity: measured on real `codex-cli 0.150.0`, an untouched thread reports
 * `258400` where the raw window is 272000, and forcing
 * `-c model_context_window=50000` reports `47500`, `=100000` reports `95000`.
 * The vendor reserves 5% and publishes the remainder, which is exactly the
 * number a compaction threshold wants -- and reading it here means a user's own
 * `~/.codex/config.toml` override is honoured for free.
 *
 * Nullable in the vendor's schema, so absence is expected rather than an error.
 */
function modelContextWindowFrom(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const window = (value as Record<string, unknown>).modelContextWindow
  if (typeof window !== 'number' || !Number.isSafeInteger(window) || window <= 0) return undefined
  return window
}

function usageFrom(value: unknown): TokenUsage {
  const tokenUsage = object(value, 'token usage')
  const last = object(tokenUsage.last, 'last-turn token usage')
  const integer = (field: string): number => {
    const count = last[field]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`codex-plugin-dsh: App Server returned invalid ${field}`)
    }
    return count
  }
  const input = integer('inputTokens')
  const cached = integer('cachedInputTokens')
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: integer('outputTokens'),
    cacheReadTokens: cached,
    reasoningTokens: integer('reasoningOutputTokens'),
  }
}

function availableDecisions(params: Record<string, unknown>): ReadonlySet<string> | undefined {
  if (!Array.isArray(params.availableDecisions)) return undefined
  return new Set(params.availableDecisions.filter((value): value is string => typeof value === 'string'))
}

function deniedDecision(params: Record<string, unknown>, cancelled: boolean): 'cancel' | 'decline' {
  const available = availableDecisions(params)
  if (cancelled && (available === undefined || available.has('cancel'))) return 'cancel'
  if (available === undefined || available.has('decline')) return 'decline'
  if (available.has('cancel')) return 'cancel'
  throw new Error('codex-plugin-dsh: App Server offered no fail-closed approval decision')
}

function catalogModel(value: unknown): CatalogModel | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.hidden === true) return undefined
  const efforts = Array.isArray(raw.supportedReasoningEfforts)
    ? raw.supportedReasoningEfforts.flatMap((item) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
        const effort = item as Record<string, unknown>
        if (typeof effort.reasoningEffort !== 'string' || effort.reasoningEffort.length === 0) return []
        return [{
          id: effort.reasoningEffort,
          ...typeof effort.description === 'string' && effort.description.length > 0
            ? { description: effort.description }
            : {},
        }]
      })
    : []
  const inputModalities = Array.isArray(raw.inputModalities)
    ? raw.inputModalities.filter((item): item is ModelModality => item === 'text' || item === 'image')
    : ['text'] as const
  return {
    id: raw.id,
    name: typeof raw.displayName === 'string' && raw.displayName.length > 0 ? raw.displayName : raw.id,
    ...typeof raw.description === 'string' && raw.description.length > 0 ? { description: raw.description } : {},
    ...typeof raw.defaultReasoningEffort === 'string' && raw.defaultReasoningEffort.length > 0
      ? { defaultReasoningEffort: raw.defaultReasoningEffort }
      : {},
    supportedReasoningEfforts: efforts,
    inputModalities,
  }
}

function disabledCodexSkills(value: unknown): readonly { readonly path: string; readonly enabled: false }[] {
  const result = object(value, 'skills/list response')
  if (!Array.isArray(result.data)) throw new Error('codex-plugin-dsh: App Server returned invalid skills/list data')
  const paths = new Set<string>()
  const failures: string[] = []
  for (const rawEntry of result.data) {
    const entry = object(rawEntry, 'skills/list entry')
    if (!Array.isArray(entry.skills) || !Array.isArray(entry.errors)) {
      throw new Error('codex-plugin-dsh: App Server returned invalid skills/list entry')
    }
    for (const rawError of entry.errors) {
      const error = object(rawError, 'skills/list error')
      const path = typeof error.path === 'string' ? `${error.path}: ` : ''
      failures.push(`${path}${messageText(error)}`)
    }
    for (const rawSkill of entry.skills) {
      const skill = object(rawSkill, 'skills/list skill')
      paths.add(string(skill.path, 'skill path'))
    }
  }
  if (failures.length > 0) {
    throw new Error(`codex-plugin-dsh: Codex skill discovery failed; refusing to start primary thread: ${failures.join('; ')}`)
  }
  return [...paths].map(path => ({ path, enabled: false as const }))
}

/**
 * Marks a checkpoint-realignment failure as unconditionally recoverable by
 * rebuilding a fresh thread from durable DSH history, regardless of what the
 * vendor said (or failed to say). Used for failure classes that have no
 * stable, named vendor error shape to pattern-match the way
 * {@link recoverableCheckpointError} does for `thread/resume`/`thread/fork`:
 *
 * - `thread/rollback` throwing at all. Unlike resume/fork, rollback has no
 *   catalogued error shapes; by the time it runs, DSH has already committed
 *   to realigning this thread (the checkpoint is a known ancestor of the
 *   tip), so any failure here -- the thread deleted between resume and
 *   rollback, a transport drop, any other vendor hiccup -- leaves the
 *   checkpoint just as unusable as a named "thread not found" would.
 *   Propagating a hard turn failure for what is, by construction, a
 *   recoverable-by-design situation would be strictly worse than rebuilding.
 * - A malformed `thread/resume` response (`thread.turns` missing or not an
 *   array). This is not a vendor error at all, so it can never match a
 *   `JsonRpcResponseError` shape; it is exactly the same "cannot use this
 *   checkpoint" situation every named error already rebuilds from.
 */
class CheckpointUnusable extends Error {}

/**
 * Recognize a checkpoint-realignment failure that DSH can safely recover
 * from by rebuilding a fresh thread from its own durable history.
 *
 * The three `thread not found` / `no rollout found` / `failed to load
 * thread` shapes surface from `thread/resume` (and `thread/fork`) when the
 * whole vendor thread is gone; the three `lastTurnId '...'` shapes surface
 * only from `thread/fork`, when the thread exists but the specific turn does
 * not (already gone, not yet canonical, or still in-progress). Both families
 * land in the same rebuild, because DSH has no other anchor to resume from
 * once either is missing. See {@link CheckpointUnusable} for the other,
 * unconditionally-recoverable failure classes this does not need to name.
 */
function recoverableCheckpointError(error: unknown, checkpoint: CodexReplayState): boolean {
  if (error instanceof CheckpointUnusable) return true
  if (!(error instanceof JsonRpcResponseError) || error.code !== -32600) return false
  return error.message === `thread not found: ${checkpoint.threadId}`
    || error.message === `no rollout found for thread id ${checkpoint.threadId}`
    || error.message.startsWith(`failed to load thread ${checkpoint.threadId}:`)
    || error.message === `lastTurnId '${checkpoint.turnId}' was not found in the source thread`
    || error.message === `lastTurnId '${checkpoint.turnId}' is not a persisted canonical turn in the source thread`
    || error.message === `lastTurnId '${checkpoint.turnId}' identifies an in-progress turn`
}

/**
 * Chronological turn ids from a `thread/resume` (or `thread/start` /
 * `thread/fork`) response's `thread.turns`. Turn ids are UUIDv7, so arrival
 * order in this array is also creation order; the last entry is the
 * thread's current tip.
 */
function resumedTurnIds(thread: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(thread.turns)) throw new CheckpointUnusable('codex-plugin-dsh: App Server returned invalid thread.turns')
  return thread.turns.map(turn => string(object(turn, 'thread/resume turn').id, 'thread/resume turn id'))
}

/** Local Codex App Server route with session-aware history, permissions, and process ownership. */
export class CodexAppServerAdapter extends LlmAdapter {
  /**
   * Usable context window per model id, as the vendor disclosed it on a turn
   * that actually ran. Empty until then, and `resolveModel` reports no context
   * capacity while it is -- absence is legal (invariant 4) and is the honest
   * answer, where a hardcoded per-`gpt-5.x` figure would be a guess that goes
   * stale silently when the vendor retunes a model or the user overrides it.
   */
  private readonly contextWindows = new Map<string, number>()
  private cachedModels: { readonly expiresAt: number; readonly models: readonly CatalogModel[] } | undefined
  private pendingModels: Promise<readonly CatalogModel[]> | undefined
  private readonly activeTurns = new Map<string, ActiveCodexTurn>()
  /**
   * Sessions with a step in flight.
   *
   * `activeTurns` is only written once a turn is open, so two concurrent
   * requests for one session both saw no turn and both opened one -- two App
   * Server processes, one of which was then dropped on the floor when the second
   * overwrote the map. A DSH session runs one step at a time, so a second
   * concurrent request means the caller lost track of its own turn boundaries;
   * the `antigravity-cli` route has refused it explicitly for the same reason.
   */
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly config: AdapterConfig,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Codex App Server (local)' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return (await this.models()).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      ...model.description === undefined ? {} : { description: model.description },
      inputModalities: model.inputModalities,
    }))
  }

  override async resolveModel(
    provider: string,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    // Reported for a model absent from the catalog too: the catalog can drop a
    // model the caller still names, and a window this adapter watched the vendor
    // publish for it is no less true for that.
    const contextWindow = this.contextWindows.get(modelId)
    const context = contextWindow === undefined ? {} : { context: { contextWindow } }
    const model = (await this.models(signal)).find(candidate => candidate.id === modelId)
    if (model === undefined) return { provider, id: modelId, name: modelId, inputModalities: ['text'], ...context }
    return {
      provider,
      id: model.id,
      name: model.name,
      ...model.description === undefined ? {} : { description: model.description },
      inputModalities: model.inputModalities,
      ...context,
      ...model.supportedReasoningEfforts.length === 0
        ? {}
        : {
            reasoning: {
              efforts: model.supportedReasoningEfforts.map(effort => ({
                id: ReasoningEffortId(effort.id),
                name: effort.id,
                ...effort.description === undefined ? {} : { description: effort.description },
              })),
              ...model.defaultReasoningEffort === undefined
                ? {}
                : { defaultEffort: ReasoningEffortId(model.defaultReasoningEffort) },
            },
          },
    }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== CODEX_APP_SERVER_PROVIDER) {
      throw new Error(`codex-plugin-dsh: unexpected provider ${JSON.stringify(options.provider)}`)
    }
    options = projectCodexPrimaryHistory(options)
    if (options.sessionId === undefined) {
      throw new Error('codex-plugin-dsh: Codex App Server calls require a live DSH session')
    }
    const isAuxiliary = options.purpose !== undefined
    // For auxiliary requests (compaction, session-title), maxTokens is accepted
    // rather than honoured, because the App Server exposes no equivalent knob.
    const unsupported = [
      options.temperature === undefined ? undefined : 'temperature',
      options.maxTokens === undefined || isAuxiliary ? undefined : 'maxTokens',
      options.stop === undefined ? undefined : 'stop',
    ].filter((value): value is string => value !== undefined)
    if (unsupported.length > 0) {
      throw new Error(`codex-plugin-dsh: App Server does not support DSH request field(s): ${unsupported.join(', ')}`)
    }
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) {
      throw new Error(`codex-plugin-dsh: session ${JSON.stringify(options.sessionId)} is not live`)
    }
    const cwd = session.header.cwd
    if (cwd === undefined) {
      throw new Error('codex-plugin-dsh: the selected DSH session has no working directory')
    }
    const sessionId = String(options.sessionId)
    if (!isAuxiliary) {
      if (this.inFlight.has(sessionId)) {
        throw new Error('codex-plugin-dsh: Codex received a second concurrent request for one DSH session')
      }
      this.inFlight.add(sessionId)
    }
    try {
      const turn = await this.startTurn(options, sessionId, cwd)
      try {
        let decision: CodexDecision | undefined
        let decisionItemId: string | undefined
        let unconstrainedText: string | undefined
        for (;;) {
          const notification = await turn.events.next(turn.signal)
          const { method, params } = notification
          if (method === 'error') {
            // A fatal App Server error may arrive without a threadId (or with
            // one that does not identify any thread), and the generic filter
            // below would otherwise drop it and leave this turn waiting until
            // turnTimeoutMs. Treat only a DIFFERENT, non-empty threadId as
            // belonging to someone else's thread; anything else is ours.
            const errorThreadId = typeof params.threadId === 'string' ? params.threadId : undefined
            if (errorThreadId !== undefined && errorThreadId.length > 0 && errorThreadId !== turn.threadId) continue
            if (params.willRetry === true && turn.consecutiveRetryingErrors < MAX_CONSECUTIVE_RETRYING_ERRORS) {
              turn.consecutiveRetryingErrors += 1
              continue
            }
            throw notificationFailure(params.error)
          }
          if (params.threadId !== turn.threadId) continue
          const notificationTurnId = method === 'turn/completed'
            ? object(params.turn, 'turn/completed turn').id
            : params.turnId
          if (notificationTurnId !== turn.turnId) continue
          // Anything addressed to this turn is progress: the vendor recovered
          // from whatever it said it would retry. Forgive the run so a later
          // hiccup is judged on its own, not on this turn's whole history.
          turn.consecutiveRetryingErrors = 0
          if (method === 'item/started') {
            const item = object(params.item, 'started item')
            if (item.type !== 'agentMessage') continue
            const itemId = string(item.id, 'agent message item id')
            const phase = phaseOf(item.phase)
            if (turn.blocks.has(itemId)) continue
            if (phase === 'commentary') {
              const block: ActiveBlock = {
                index: turn.nextBlockIndex++,
                type: 'reasoning',
                phase: 'commentary',
                text: '',
                ended: false,
              }
              turn.blocks.set(itemId, block)
              yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
              continue
            }
            if (phase === 'final_answer') {
              if ((decisionItemId !== undefined && decisionItemId !== itemId) || decision !== undefined || unconstrainedText !== undefined) {
                throw new Error('codex-plugin-dsh: App Server emitted a second non-commentary agent message in one turn')
              }
              decisionItemId = itemId
              const block: ActiveBlock = {
                index: -1,
                type: 'text',
                phase: 'final_answer',
                text: '',
                ended: false,
              }
              turn.blocks.set(itemId, block)
              continue
            }
            // An agent message with an unknown phase (null) at item/started is buffered
            // without claiming decisionItemId or assigning a block index.
            const block: ActiveBlock = {
              index: -1,
              type: 'text',
              phase: null,
              text: '',
              ended: false,
            }
            turn.blocks.set(itemId, block)
            continue
          }
          if (method === 'item/agentMessage/delta') {
            const itemId = string(params.itemId, 'agent message delta item id')
            let block = turn.blocks.get(itemId)
            if (block === undefined) {
              // A block created from a delta has an unknown phase (null), not yet
              // known to be the decision. Do not claim decisionItemId and do not
              // assign a block index yet (-1 sentinel). Text is buffered until item/completed.
              block = { index: -1, type: 'text', phase: null, text: '', ended: false }
              turn.blocks.set(itemId, block)
            }
            if (block.ended) throw new Error('codex-plugin-dsh: App Server emitted a delta after item/completed')
            if (typeof params.delta !== 'string') {
              throw new Error('codex-plugin-dsh: App Server emitted a non-string agent message delta')
            }
            const delta = params.delta
            block.text += delta
            if (block.phase === 'commentary') {
              // -1 is a sentinel meaning no block index has been assigned yet.
              // Chunks are never emitted with a negative index. A commentary block
              // created from item/started has a valid non-negative index; a delta-first block
              // has phase null and buffers until item/completed, making this yield unreachable
              // with a negative index.
              if (block.index < 0) {
                throw new Error('codex-plugin-dsh: internal invariant: commentary block has no assigned index')
              }
              yield { type: 'reasoning-delta', index: block.index, text: delta }
            }
            continue
          }
          if (method === 'item/completed') {
            const item = object(params.item, 'completed item')
            if (item.type === 'imageGeneration') {
              const itemId = string(item.id, 'image generation item id')
              if (turn.completedImages.has(itemId)) continue
              turn.completedImages.add(itemId)
              const image = await generatedImageBlock(this.ctx.attachments, item)
              if (image === undefined) continue
              const index = turn.nextBlockIndex++
              yield { type: 'block-start', index, blockType: 'image' }
              yield { type: 'block-end', index, block: image }
              turn.finalOutput = true
              continue
            }
            if (item.type !== 'agentMessage') continue
            const itemId = string(item.id, 'completed agent message item id')
            const phase = phaseOf(item.phase)
            let block = turn.blocks.get(itemId)
            const completedText = typeof item.text === 'string' ? item.text : ''
            if (block !== undefined && !completedText.startsWith(block.text)) {
              throw new Error('codex-plugin-dsh: completed agent message did not match its streamed deltas')
            }
            if (phase === 'commentary') {
              if (block === undefined || block.index === -1) {
                // A commentary block created from a delta before item/started (or without prior events)
                // has an unknown phase until item/completed. Assign a real index from turn.nextBlockIndex++,
                // emit block-start, emit the accumulated text as one reasoning-delta, then block-end.
                const index = turn.nextBlockIndex++
                block = {
                  index,
                  type: 'reasoning',
                  phase: 'commentary',
                  text: completedText,
                  ended: true,
                }
                turn.blocks.set(itemId, block)
                yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
                if (completedText.length > 0) {
                  yield { type: 'reasoning-delta', index: block.index, text: completedText }
                }
                yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
                continue
              }
              // A block whose phase was known at item/started already emitted block-start.
              const tail = completedText.slice(block.text.length)
              if (tail.length > 0) {
                yield { type: 'reasoning-delta', index: block.index, text: tail }
                block.text = completedText
              }
              block.ended = true
              yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
              continue
            }
            // Anything else is the decision: claim it, parse it, emit nothing.
            if ((decisionItemId !== undefined && decisionItemId !== itemId) || decision !== undefined || unconstrainedText !== undefined) {
              throw new Error('codex-plugin-dsh: App Server emitted a second non-commentary agent message in one turn')
            }
            decisionItemId = itemId
            if (block === undefined) {
              block = { index: -1, type: 'text', phase, text: completedText, ended: true }
              turn.blocks.set(itemId, block)
            } else {
              block.phase = phase
              block.text = completedText
              block.ended = true
            }
            if (!turn.constrained) {
              unconstrainedText = completedText
            } else {
              decision = codexDecision(completedText, options.tools)
            }
            continue
          }
          if (method === 'thread/tokenUsage/updated') {
            turn.usage = usageFrom(params.tokenUsage)
            const window = modelContextWindowFrom(params.tokenUsage)
            if (window !== undefined) this.contextWindows.set(turn.model, window)
            continue
          }
          if (method !== 'turn/completed') continue
          const completedTurn = object(params.turn, 'turn/completed turn')
          if (contextWindowExceeded(completedTurn)) {
            if (turn.usage !== undefined) yield { type: 'usage', usage: turn.usage }
            yield {
              type: 'finish',
              reason: { kind: 'max-tokens' },
              ...isAuxiliary ? {} : { replayState: { response: turn.replayState } },
            }
            return
          }
          if (completedTurn.status !== 'completed') throw turnFailure(completedTurn)
          if ([...turn.blocks.values()].some(block => !block.ended)) {
            throw new Error('codex-plugin-dsh: App Server completed with an open agent message')
          }
          if (!turn.constrained) {
            if (unconstrainedText === undefined || unconstrainedText.trim().length === 0) {
              if (!turn.finalOutput) throw new Error('codex-plugin-dsh: App Server completed without a final answer or image')
              if (turn.usage !== undefined) yield { type: 'usage', usage: turn.usage }
              yield { type: 'finish', reason: { kind: 'stop' }, ...isAuxiliary ? {} : { replayState: { response: turn.replayState } } }
              return
            }
            const index = turn.nextBlockIndex++
            yield { type: 'block-start', index, blockType: 'text' }
            yield { type: 'text-delta', index, text: unconstrainedText }
            yield { type: 'block-end', index, block: { type: 'text', text: unconstrainedText } }
            if (turn.usage !== undefined) yield { type: 'usage', usage: turn.usage }
            yield { type: 'finish', reason: { kind: 'stop' }, ...isAuxiliary ? {} : { replayState: { response: turn.replayState } } }
            return
          }
          if (decision === undefined) {
            if (!turn.finalOutput) throw new Error('codex-plugin-dsh: App Server completed without a final answer or image')
            if (turn.usage !== undefined) yield { type: 'usage', usage: turn.usage }
            yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: turn.replayState } }
            return
          }
          if (decision.kind === 'final') {
            if (decision.message.trim().length === 0) {
              throw new Error('codex-plugin-dsh: App Server completed without a final answer or image')
            }
            const index = turn.nextBlockIndex++
            yield { type: 'block-start', index, blockType: 'text' }
            yield { type: 'text-delta', index, text: decision.message }
            yield { type: 'block-end', index, block: { type: 'text', text: decision.message } }
            if (turn.usage !== undefined) yield { type: 'usage', usage: turn.usage }
            yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: turn.replayState } }
            return
          }
          if (decision.kind === 'tool_call') {
            const id = ToolCallId(`codex-${randomUUID()}`)
            const argumentsText = JSON.stringify(decision.arguments)
            const index = turn.nextBlockIndex++
            const block: ContentBlock = {
              type: 'tool-call',
              id,
              name: decision.name,
              arguments: argumentsText,
            }
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id, name: decision.name, argumentsDelta: argumentsText }
            yield { type: 'block-end', index, block }
            turn.replayState = {
              ...turn.replayState,
              decisionDigest: codexDecisionDigest([block]),
            }
            if (turn.usage !== undefined) yield { type: 'usage', usage: turn.usage }
            yield { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: turn.replayState } }
            return
          }
        }
      } finally {
        await this.closeTurn(turn)
      }
    } finally {
      if (!isAuxiliary) {
        this.inFlight.delete(sessionId)
      }
    }
  }

  private async startTurn(
    options: GenerateOptions,
    sessionId: string,
    cwd: string,
  ): Promise<ActiveCodexTurn> {
    const isAuxiliary = options.purpose !== undefined
    const registryKey = isAuxiliary ? `${sessionId}#aux-${randomUUID()}` : sessionId
    const step = this.#armStep(options)
    const signal = step.signal
    const imageUrls = new Map<string, Promise<string>>()
    const resolveImageUrl = (attachment: ImageAttachmentRef): Promise<string> => {
      const key = String(attachment.attachmentId)
      const existing = imageUrls.get(key)
      if (existing !== undefined) return existing
      const pending = attachmentDataUrl(this.ctx.attachments, attachment, signal)
      imageUrls.set(key, pending)
      return pending
    }
    let history = await prepareCodexHistory(
      options.messages,
      CODEX_APP_SERVER_PROVIDER,
      resolveImageUrl,
      sessionId,
      isAuxiliary,
    )
    const events = new ActiveTurnQueue()
    let threadId: string | undefined
    let turnId: string | undefined
    let connection: CodexAppServerConnection | undefined
    const observer: AppServerConnectionObserver = {
      notification: notification => { events.push(notification) },
      failure: error => { events.fail(error) },
    }
    try {
      connection = await this.openConnection(
        cwd,
        signal,
        (method, params) => this.handleServerRequest(method, params),
        observer,
      )
      await connection.initialize(signal)
      const isolationConfig = await this.isolationConfig(connection, cwd, signal)
      let threadResult: Record<string, unknown>
      if (isAuxiliary || history.checkpoint === undefined) {
        threadResult = await connection.request(
          'thread/start',
          this.threadParams(options, cwd, isolationConfig),
          signal,
        )
      } else {
        const checkpoint = history.checkpoint
        try {
          // Resume the persisted vendor thread instead of forking a new one
          // every turn. Forking every turn earns zero prompt-cache credit
          // (each turn re-bills the whole accumulated context as fresh
          // input, measured against real codex-cli 0.150.0); resuming one
          // thread gets credit for ~90% of input (e.g. 3840 cached of
          // 4249). `thread/resume`'s response carries `thread.turns`, so the
          // vendor thread's tip is known here without a `thread/read` round
          // trip. The same configuration overrides thread/start and
          // thread/fork send go along with the resume, via
          // threadConfigOverrides -- baseInstructions/model/sandbox/config
          // are per-turn DSH state (e.g. the runtime-context snapshot),
          // not one-time thread-creation state, and must keep landing on
          // every resumed turn, not just the turn that created the thread.
          const resumeResult = await connection.request('thread/resume', {
            threadId: checkpoint.threadId,
            ...this.threadConfigOverrides(options, cwd, isolationConfig),
          }, signal)
          const resumedThread = object(resumeResult.thread, 'thread/resume thread')
          const turns = resumedTurnIds(resumedThread)
          // Turn ids are UUIDv7 and should be unique, but `lastIndexOf`
          // (rather than `indexOf`) is used deliberately: if that assumption
          // were ever violated, matching the LAST occurrence resolves a
          // duplicate toward "in sync" rather than "ahead". That costs
          // nothing when ids are unique (both finds agree), and when they are
          // not it avoids the destructive `thread/rollback` below firing
          // against turns that are still current.
          const tipIndex = turns.lastIndexOf(checkpoint.turnId)
          if (tipIndex !== -1 && tipIndex === turns.length - 1) {
            // In sync: the vendor thread's tip is exactly DSH's checkpoint.
            // This is the common case, and the one that keeps the cache.
            threadResult = resumeResult
          } else if (tipIndex !== -1) {
            // Ahead: the checkpoint is an ancestor of the tip, not the tip
            // itself (DSH history was rolled back or edited after this
            // checkpoint was taken). Realign by dropping exactly the turns
            // after the checkpoint. Unlike fork, thread/rollback is
            // destructive -- it discards the trailing turns outright rather
            // than leaving them on a branch -- but that is acceptable here
            // because DSH's own history no longer reaches them either, and
            // rollback does not cost the cache (measured: 3840 cached
            // tokens both before and after dropping one turn).
            //
            // thread/rollback has no catalogued vendor error shape the way
            // resume/fork do, so any failure here (thread deleted between
            // resume and rollback, a transport drop, any other vendor
            // hiccup) is wrapped as `CheckpointUnusable` and always falls
            // into the rebuild-from-DSH-history path below -- by this point
            // the checkpoint is already known stale, so any failure to trim
            // it forward is definitionally "cannot use this checkpoint".
            try {
              await connection.request('thread/rollback', {
                threadId: checkpoint.threadId,
                numTurns: turns.length - 1 - tipIndex,
              }, signal)
            } catch (cause) {
              throw new CheckpointUnusable('codex-plugin-dsh: thread/rollback failed', { cause })
            }
            threadResult = resumeResult
          } else {
            // Not found: the checkpoint's turn is neither the tip nor an
            // ancestor of it, so no rollback trim reaches it -- resume and
            // rollback can only address a turn by its position relative to
            // the tip. thread/fork is kept for exactly this: it takes
            // lastTurnId and addresses a turn by id (fork "through, i.e.
            // inclusive of it") regardless of the thread's current tip. If
            // the turn is genuinely gone, fork fails with the same named
            // errors the rebuild below already recovers from.
            threadResult = await connection.request('thread/fork', {
              ...this.threadParams(options, cwd, isolationConfig),
              threadId: checkpoint.threadId,
              lastTurnId: checkpoint.turnId,
            }, signal)
          }
        } catch (error) {
          if (!recoverableCheckpointError(error, checkpoint)) throw error
          history = await prepareCodexHistory(
            options.messages,
            CODEX_APP_SERVER_PROVIDER,
            resolveImageUrl,
            sessionId,
            true,
          )
          threadResult = await connection.request(
            'thread/start',
            this.threadParams(options, cwd, isolationConfig),
            signal,
          )
        }
      }
      const thread = object(threadResult.thread, 'thread result')
      threadId = string(thread.id, 'thread id')
      if (history.injectItems.length > 0) {
        await connection.request('thread/inject_items', {
          threadId,
          items: history.injectItems,
        }, signal)
      }
      const outputSchema = isAuxiliary ? undefined : codexOutputSchema(options.tools)
      const turnResult = await connection.request('turn/start', {
        threadId,
        input: history.turnInput,
        model: options.model,
        ...options.reasoningEffort === undefined ? {} : { effort: options.reasoningEffort },
        ...outputSchema === undefined ? {} : { outputSchema },
      }, signal)
      const turn = object(turnResult.turn, 'turn/start turn')
      turnId = string(turn.id, 'turn id')
      let active!: ActiveCodexTurn
      active = {
        registryKey,
        sessionId,
        model: options.model,
        constrained: outputSchema !== undefined,
        connection,
        events,
        signal,
        step,
        threadId,
        turnId,
        replayState: {
          kind: 'codex-app-server',
          version: 2,
          threadId,
          turnId,
          sessionId,
          prefixLength: options.messages.length,
          prefixDigest: codexHistoryDigest(options.messages),
        },
        resolveImageUrl,
        onAbort: () => {
          connection?.interrupt(threadId as string, turnId as string)
          void this.closeTurn(active)
        },
        blocks: new Map(),
        completedImages: new Set(),
        nextBlockIndex: 0,
        finalOutput: false,
        consecutiveRetryingErrors: 0,
      }
      active.signal.addEventListener('abort', active.onAbort, { once: true })
      this.activeTurns.set(active.registryKey, active)
      return active
    } catch (error) {
      step.abort()
      events.fail(thrown(error))
      await connection?.close()
      throw error
    }
  }

  /**
   * The vendor turn no longer spans DSH steps, so the step's own signal and
   * timeout bound the whole thing.
   */
  #armStep(options: GenerateOptions): AbortController {
    return combinedSignal(options.signal, this.config.turnTimeoutMs)
  }

  private async closeTurn(active: ActiveCodexTurn): Promise<void> {
    if (active.closing !== undefined) return active.closing
    const closing = this.finishCloseTurn(active)
    active.closing = closing
    return closing
  }

  private async finishCloseTurn(active: ActiveCodexTurn): Promise<void> {
    if (this.activeTurns.get(active.registryKey) === active) this.activeTurns.delete(active.registryKey)
    active.signal.removeEventListener('abort', active.onAbort)
    active.step.abort()
    active.events.fail(new Error('codex-plugin-dsh: App Server turn closed'))
    await active.connection.close()
  }

  /** Close an unfinished App Server turn after the owning DSH turn ends. */
  closeSession(sessionId: string): void {
    const active = this.activeTurns.get(sessionId)
    if (active !== undefined) void this.closeTurn(active)
  }

  /** Dispose every App Server process retained across DSH tool execution. */
  async dispose(): Promise<void> {
    await Promise.all([...this.activeTurns.values()].map(active => this.closeTurn(active)))
  }

  /**
   * Configuration overrides shared by every thread-establishing request
   * (`thread/start`, `thread/fork`, `thread/resume`). Single source so
   * `thread/resume` cannot silently drift from what a fresh or forked
   * thread would get: `options.system` genuinely changes turn to turn (the
   * DSH runtime-context snapshot supersedes the previous one), so a resumed
   * thread must receive the current `baseInstructions`/`model`/`sandbox`/
   * `config` on every turn, not just the turn that created the thread.
   *
   * `ThreadResumeParams` accepts exactly this field set plus
   * `approvalsReviewer`, `modelProvider`, `personality`, `serviceTier` (none
   * of which this adapter sets); it does NOT accept `ephemeral`, and the App
   * Server rejects unknown fields, so that is added only by {@link threadParams}
   * for `thread/start`/`thread/fork`.
   */
  private threadConfigOverrides(
    options: GenerateOptions,
    cwd: string,
    isolationConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      cwd,
      model: options.model,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: isolationConfig,
      baseInstructions: options.system ?? '',
      ...options.purpose !== undefined ? {} : { developerInstructions: CODEX_APP_SERVER_DEVELOPER_INSTRUCTIONS },
    }
  }

  private threadParams(
    options: GenerateOptions,
    cwd: string,
    isolationConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...this.threadConfigOverrides(options, cwd, isolationConfig),
      ephemeral: options.purpose !== undefined,
    }
  }

  private async isolationConfig(
    connection: CodexAppServerConnection,
    cwd: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const result = await connection.request('config/read', { includeLayers: false, cwd }, signal)
    const current = object(result.config, 'config/read config')
    // Shape-check the maps we already have before a second vendor round trip.
    const mcpServers = optionalObject(current.mcp_servers, 'config/read mcp_servers')
    const apps = optionalObject(current.apps, 'config/read apps')
    const skills = disabledCodexSkills(await connection.request('skills/list', { cwds: [cwd], forceReload: true }, signal))
    const disabledMcpServers = Object.fromEntries(
      Object.keys(mcpServers).map(name => [name, { enabled: false }]),
    )
    const disabledApps = Object.fromEntries(
      Object.keys(apps)
        .filter(name => name !== '_default')
        .map(name => [name, { enabled: false }]),
    )
    return {
      features: {
        shell_tool: false,
        unified_exec: false,
        shell_zsh_fork: false,
        shell_snapshot: false,
        shell_snapshot_v2: false,
        exec_permission_approvals: false,
        request_permissions_tool: false,
        multi_agent: false,
        multi_agent_v2: false,
        code_mode: false,
        memories: false,
        external_agent_memory_import: false,
        chronicle: false,
        view_image: false,
        hooks: false,
        goals: false,
        token_budget: false,
        rollout_budget: false,
        current_time_reminder: false,
        skill_search: false,
        skill_mcp_dependency_install: false,
        deferred_executor: false,
        executor_capability_discovery: false,
        apps: false,
        enable_mcp_apps: false,
        plugins: false,
        recommended_plugins: false,
        tool_suggest: false,
        remote_plugin: false,
        plugin_sharing: false,
        browser_use: false,
        browser_use_full_cdp_access: false,
        browser_use_external: false,
        computer_use: false,
        in_app_browser: false,
        in_app_chat: false,
        in_app_dictation: false,
        in_app_local_automation: false,
        in_app_updates: false,
        network_proxy: false,
        unbounded_connection_retries: false,
        guardian_approval: false,
        guardianv2: false,
        guardian_ext: false,
        tool_call_mcp_elicitation: false,
        auth_elicitation: false,
        artifact: false,
        workspace_dependencies: false,
        prevent_idle_sleep: false,
      },
      agents: { enabled: false },
      tools: {
        experimental_request_user_input: { enabled: false },
        update_plan: { enabled: false },
      },
      web_search: 'disabled',
      notify: [],
      include_permissions_instructions: false,
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      include_environment_context: false,
      allow_login_shell: false,
      orchestrator: {
        skills: { enabled: false },
        mcp: { enabled: false },
      },
      skills: {
        bundled: { enabled: false },
        include_instructions: false,
        config: skills,
      },
      apps: { _default: { enabled: false }, ...disabledApps },
      mcp_servers: disabledMcpServers,
    }
  }

  private async models(parentSignal?: AbortSignal): Promise<readonly CatalogModel[]> {
    if (this.cachedModels !== undefined && this.cachedModels.expiresAt > Date.now()) return this.cachedModels.models
    parentSignal?.throwIfAborted()

    let pending = this.pendingModels
    if (pending === undefined) {
      const signal = AbortSignal.timeout(this.config.catalogTimeoutMs)
      let created!: Promise<readonly CatalogModel[]>
      created = (async (): Promise<readonly CatalogModel[]> => {
        try {
          const models = await this.loadModels(signal)
          this.cachedModels = { expiresAt: Date.now() + this.config.modelCacheMs, models }
          return models
        } finally {
          if (this.pendingModels === created) this.pendingModels = undefined
        }
      })()
      pending = created
      this.pendingModels = created
      void created.catch(() => {})
    }
    return waitForPromise(pending, parentSignal)
  }

  private async loadModels(signal: AbortSignal): Promise<readonly CatalogModel[]> {
    const connection = await this.openConnection(process.cwd(), signal, (method) =>
      Promise.reject(new Error(`codex-plugin-dsh: unexpected App Server request during model discovery: ${method}`)))
    try {
      await connection.initialize(signal)
      const accountResult = await connection.request('account/read', { refreshToken: false }, signal)
      if (accountResult.requiresOpenaiAuth === true && accountResult.account == null) {
        throw new LlmError('Codex login is required; run `codex login` on the DSH host', 'AUTH')
      }
      const models: CatalogModel[] = []
      let cursor: string | null = null
      do {
        const result = await connection.request('model/list', {
          cursor,
          includeHidden: false,
          limit: this.config.modelPageSize,
        }, signal)
        if (!Array.isArray(result.data)) throw new Error('codex-plugin-dsh: App Server returned invalid model list')
        models.push(...result.data.flatMap(value => {
          const parsed = catalogModel(value)
          return parsed === undefined ? [] : [parsed]
        }))
        cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null
      } while (cursor !== null)
      if (models.length === 0) throw new Error('codex-plugin-dsh: App Server returned no available models')
      return models
    } finally {
      await connection.close()
    }
  }

  private async openConnection(
    cwd: string,
    signal: AbortSignal,
    requestHandler: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    observer?: AppServerConnectionObserver,
  ): Promise<CodexAppServerConnection> {
    const executable = await this.ctx.subprocess.resolveExecutable(this.config.executable, this.config.env, signal)
    const batchShim = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())
    const commandInterpreter = batchShim
      ? await this.ctx.subprocess.resolveExecutable('cmd.exe', this.config.env, signal)
      : undefined
    const invocation = codexAppServerInvocation(executable, this.config.env, process.platform, commandInterpreter)
    const child: SubprocessHandle = this.ctx.subprocess.spawn({
      argv: [...invocation.argv],
      cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: this.config.stderrMaxBytes },
      },
      graceMs: this.config.disposeGraceMs,
      env: invocation.env,
    })
    return new CodexAppServerConnection(child, requestHandler, observer)
  }

  private async handleServerRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return { decision: deniedDecision(params, false) }
      case 'item/permissions/requestApproval':
        return { permissions: {}, scope: 'turn' }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      case 'item/tool/requestUserInput':
        throw new Error('codex-plugin-dsh: App Server requested interactive user input, which this adapter does not yet bridge')
      default:
        throw new Error(`codex-plugin-dsh: unsupported App Server request ${JSON.stringify(method)}`)
    }
  }
}
