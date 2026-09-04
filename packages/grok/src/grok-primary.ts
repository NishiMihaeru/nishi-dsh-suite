/**
 * The Grok Build CLI primary route: one short-lived headless process per DSH
 * step, continuing one vendor session.
 *
 * The shape is the whole design, and it is smaller than the sibling
 * Antigravity route on purpose rather than by omission. That route holds a
 * live `agy` child per DSH session because a fresh process cannot hit the
 * vendor's prefix cache. This vendor's `--resume` does: measured on
 * `grok 1.0.13`, a second turn in a NEW process reported 140 uncached input
 * tokens against 4,480 read from cache, and reported its own spend rather than
 * the conversation's running total. So there is no live child, no delta/full
 * envelope negotiation with a process, no cumulative-usage subtraction, and no
 * idle reaper -- a step is a process, and the vendor's own session store is
 * the conversation.
 *
 * What survives from that route is the discipline, not the machinery: DSH's
 * history is authoritative and gets rewritten behind the adapter's back, so a
 * session may be continued only by a request that extends exactly what it was
 * told. See `docs/verification/grok-cli-contract.md`.
 *
 * @module nishi-dsh-grok/grok-primary
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  ToolCallId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { assertExecutableDecision, decisionSchemaFor, readDecision, type Decision } from './decision-schema.js'
import {
  agentStdioArgv,
  headlessTurnArgv,
  isArgListTooLong,
  resolveVendorInvocation,
  type VendorInvocation,
} from './grok-vendor.js'
import { decisionPayload, parseHeadlessResult, settlement, type HeadlessResult } from './headless-result.js'
import { parseCatalog, readAcpInitialize, type CatalogModel } from './model-catalog.js'
import {
  deltaPromptBlocks,
  promptFileBody,
  fullPromptBlocks,
  isOwnReply,
  messageDigest,
  requestSignature,
  transportSystemPrompt,
  type CallIdView,
} from './prompt-envelope.js'
import { GROK_PRIMARY_PROVIDER } from './provider-id.js'
import { grokVendorFailure } from './vendor-stderr.js'

export { GROK_PRIMARY_PROVIDER } from './provider-id.js'

const WINDOWS_EXECUTABLE_ENV = 'DSH_GROK_CLI_EXECUTABLE'
const MAX_TURN_STDOUT_BYTES = 4 * 1024 * 1024

export interface GrokPrimaryConfig {
  readonly executable: string
  readonly env: Record<string, string>
  readonly modelCacheMs: number
  readonly catalogTimeoutMs: number
  readonly turnTimeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
  /**
   * Context capacity used for a model the vendor's handshake did not describe.
   *
   * Unlike the Antigravity route, this is a fallback rather than the answer:
   * the ACP handshake publishes `totalContextTokens` per model (500,000 on
   * both `grok-4.6` and `grok-4.5`), so the real figure is normally read
   * rather than configured. The fallback exists because `compaction-basic`
   * refuses to run pressure compaction against a route with no capacity and
   * swallows that refusal as one warning, which means an undescribed model
   * would grow its history without bound and silently.
   */
  readonly contextWindowTokens: number
  /**
   * Ceiling on the vendor's own agent rounds within one DSH step.
   *
   * DSH owns the loop, so the vendor needs very few: the round that answers,
   * plus room for its structured-output retry when the model first answers
   * outside the schema. It is not `1` because that was measured turning an
   * ordinary retry into a dead step.
   */
  readonly vendorTurnCap: number
}

/**
 * One DSH session's vendor conversation.
 *
 * `delivered` is the whole reuse test: a request may continue this session
 * only if its messages start with exactly these digests, in order. Compaction
 * shadows nodes, the tool-result pruner truncates, repair injects synthetic
 * results, the user rewinds -- none of that is expressible to a vendor session
 * that has already heard the original, so a prefix mismatch is not an error
 * but the normal signal to open a new session from DSH's copy.
 */
interface VendorSession {
  /** Client-minted session UUID; `--session-id` opens it, `--resume` continues it. */
  id: string
  /** Identity the session was opened with; see {@link requestSignature}. */
  signature: string
  /** One digest per message already delivered, in order. */
  delivered: string[]
  /** DSH call id -> the id the model itself minted for that call. */
  readonly vendorCallIds: Map<string, string>
}

interface TurnOutcome {
  readonly result: HeadlessResult
  readonly exitCode: number | null
  readonly stderrText: string | undefined
}

export class GrokCliAdapter extends LlmAdapter {
  private workspacePromise: Promise<string> | undefined
  private cachedModels: { readonly expiresAt: number; readonly models: readonly CatalogModel[] } | undefined
  private pendingModels: Promise<readonly CatalogModel[]> | undefined
  private readonly activeChildren = new Set<SubprocessHandle>()
  private readonly sessions = new Map<string, VendorSession>()
  /**
   * Instance-scoped token embedded in every minted call id, so ids stay unique
   * across adapter restarts within one durable DSH history.
   */
  private readonly callInstanceId = randomUUID().slice(0, 8)
  private callSeq = 0
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: GrokPrimaryConfig,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Grok Build CLI (official local)' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return (await this.models()).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      inputModalities: ['text' as const],
    }))
  }

  override async resolveModel(
    provider: string,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const models = await this.models(signal).catch(() => [] as readonly CatalogModel[])
    const model = models.find(candidate => candidate.id === modelId)

    const efforts = model?.efforts ?? []
    const defaultEffort = efforts.find(effort => effort.isDefault)?.id
    const reasoning = efforts.length > 0
      ? {
          efforts: efforts.map(effort => ({
            id: ReasoningEffortId(effort.id),
            name: effort.name,
            ...(effort.description === undefined ? {} : { description: effort.description }),
          })),
          ...(defaultEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultEffort) }),
        }
      : undefined

    return {
      provider,
      id: modelId,
      name: model?.name ?? modelId,
      ...(model?.description === undefined ? {} : { description: model.description }),
      inputModalities: ['text'],
      context: { contextWindow: model?.contextWindowTokens ?? this.config.contextWindowTokens },
      ...(reasoning === undefined ? {} : { reasoning }),
    }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== GROK_PRIMARY_PROVIDER) {
      throw new LlmError(
        `Grok adapter received unexpected provider ${JSON.stringify(options.provider)}`,
        'GROK_CLI',
      )
    }
    this.assertSupported(options)

    const requestedTools = new Set((options.tools ?? []).map(tool => tool.name))
    const auxiliary = options.purpose !== undefined
    const turn = randomUUID()

    const { session, blocks } = this.prepareTurn(options, turn, auxiliary)
    const outcome = await this.runTurn(options, session, blocks, auxiliary, turn)

    const settled = settlement(outcome.result, outcome.exitCode, outcome.stderrText)
    if (settled.kind !== 'success') {
      this.forget(options, session)
      throw this.turnFailure(settled, outcome)
    }

    let decision: Decision
    try {
      const payload = decisionPayload(outcome.result)
      if (payload === undefined && outcome.result.noStructuredOutput) {
        throw new LlmError(
          'Grok CLI turn ended without a schema-bound decision '
          + '(the model answered outside the forced JSON schema).',
          'GROK_PROTOCOL',
        )
      }
      decision = readDecision(payload, turn)
      assertExecutableDecision(decision, requestedTools)
    } catch (error) {
      // The session is abandoned rather than continued: a step whose decision
      // could not be read leaves DSH's history and the vendor's disagreeing
      // about whether that exchange happened, and only DSH's is authoritative.
      this.forget(options, session)
      throw error
    }

    // Commit the delivered prefix only once the decision is usable. A step
    // that failed above never happened as far as DSH is concerned, and a
    // session recorded as having heard messages it will never be asked about
    // again is a session that would continue from the wrong place.
    this.commit(options, session, outcome.result.sessionId, auxiliary)

    let nextIndex = 0
    if (decision.text.length > 0) {
      const index = nextIndex++
      yield { type: 'block-start', index, blockType: 'text' }
      yield { type: 'text-delta', index, text: decision.text }
      yield { type: 'block-end', index, block: { type: 'text', text: decision.text } }
    }

    for (const call of decision.tool_calls) {
      const index = nextIndex++
      const id = this.mintCallId(call.id, session)
      const argumentsText = JSON.stringify(call.arguments)
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: argumentsText }
      yield {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id, name: call.name, arguments: argumentsText },
      }
    }

    if (outcome.result.usage !== undefined) {
      yield { type: 'usage', usage: outcome.result.usage }
    }
    yield {
      type: 'finish',
      reason: decision.tool_calls.length > 0 ? { kind: 'tool-calls' } : { kind: 'stop' },
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.sessions.clear()
    for (const child of this.activeChildren) child.terminate()
    await Promise.allSettled([...this.activeChildren].map(child => child.waitForExit()))
    const workspace = this.workspacePromise
    this.workspacePromise = undefined
    if (workspace !== undefined) {
      await workspace.then(root => rm(root, { recursive: true, force: true })).catch(() => {})
    }
  }

  /**
   * Request fields this vendor's headless entry cannot honour.
   *
   * `temperature` and `stop` have no flag at all. `maxTokens` has none either,
   * and rejecting it is honest for an ordinary turn -- but an auxiliary call is
   * different in kind: compaction and session titles pass it as a budget hint
   * for a summary nobody measures, and refusing it there would disable the only
   * mechanism bounding a session's history.
   */
  private assertSupported(options: GenerateOptions): void {
    const unsupported = [
      options.temperature === undefined ? undefined : 'temperature',
      options.maxTokens === undefined || options.purpose !== undefined ? undefined : 'maxTokens',
      options.stop === undefined ? undefined : 'stop',
    ].filter((value): value is string => value !== undefined)
    if (unsupported.length > 0) {
      throw new LlmError(
        `Grok Build CLI primary does not support DSH request field(s): ${unsupported.join(', ')}`,
        'UNSUPPORTED',
      )
    }
  }

  private sessionKey(options: GenerateOptions): string | undefined {
    const id = options.sessionId
    return typeof id === 'string' && id.length > 0 ? id : undefined
  }

  private callIdView(session: VendorSession | undefined): CallIdView {
    return (dshId: string) => session?.vendorCallIds.get(dshId) ?? dshId
  }

  private mintCallId(vendorId: string, session: VendorSession | undefined): ReturnType<typeof ToolCallId> {
    this.callSeq += 1
    const id = ToolCallId(`grok-${this.callInstanceId}-${this.callSeq}`)
    // Remember what the vendor called this, so a result handed back cites the
    // id the model itself wrote. An id already spoken for by an earlier call of
    // this session is not remapped: reusing an id across turns is ordinary for
    // a model-authored id, and restoring it twice would put two results under
    // one id in the history a rebuild replays.
    if (session !== undefined && ![...session.vendorCallIds.values()].includes(vendorId)) {
      session.vendorCallIds.set(String(id), vendorId)
    }
    return id
  }

  /**
   * Decide whether this step continues a vendor session or opens one, and
   * build the prompt blocks either way.
   *
   * An auxiliary call never touches the DSH session's conversation: it brings
   * its own system prompt and its own one-off history, so sharing would fail
   * the prefix test and abandon the real session on every compaction fold.
   */
  private prepareTurn(
    options: GenerateOptions,
    turn: string,
    auxiliary: boolean,
  ): { session: VendorSession; blocks: ReturnType<typeof fullPromptBlocks> } {
    if (auxiliary) {
      const session: VendorSession = {
        id: randomUUID(),
        signature: requestSignature(options),
        delivered: [],
        vendorCallIds: new Map(),
      }
      return { session, blocks: fullPromptBlocks(options, this.callIdView(undefined), turn) }
    }

    const key = this.sessionKey(options)
    const existing = key === undefined ? undefined : this.sessions.get(key)
    const signature = requestSignature(options)

    if (existing !== undefined && existing.signature === signature) {
      const digests = options.messages.map(messageDigest)
      const extends_ = existing.delivered.length <= digests.length
        && existing.delivered.every((digest, index) => digests[index] === digest)
      if (extends_) {
        const appended = options.messages.slice(existing.delivered.length)
        // The vendor has already heard its own replies, from itself. Echoing
        // them back as user data doubles every action in the transcript, which
        // is how a model learns to repeat one.
        const news = appended.filter(message => !isOwnReply(message))
        return {
          session: existing,
          blocks: deltaPromptBlocks(news, this.callIdView(existing), turn),
        }
      }
    }

    const session: VendorSession = {
      id: randomUUID(),
      signature,
      delivered: [],
      vendorCallIds: new Map(),
    }
    if (key !== undefined) this.sessions.set(key, session)
    return { session, blocks: fullPromptBlocks(options, this.callIdView(session), turn) }
  }

  /** Record what this session has now been told, once the step is known good. */
  private commit(
    options: GenerateOptions,
    session: VendorSession,
    reportedSessionId: string | undefined,
    auxiliary: boolean,
  ): void {
    if (auxiliary) return
    session.delivered = options.messages.map(messageDigest)
    // The vendor echoes the session id back. It should be the one this route
    // minted; if it ever is not, the next step must resume what actually
    // exists rather than what was asked for.
    if (reportedSessionId !== undefined && reportedSessionId !== session.id) {
      session.id = reportedSessionId
    }
  }

  /** Drop a session so the next step opens a new one from DSH's own history. */
  private forget(options: GenerateOptions, session: VendorSession): void {
    const key = this.sessionKey(options)
    if (key !== undefined && this.sessions.get(key) === session) this.sessions.delete(key)
  }

  private async runTurn(
    options: GenerateOptions,
    session: VendorSession,
    blocks: ReturnType<typeof fullPromptBlocks>,
    auxiliary: boolean,
    turn: string,
  ): Promise<TurnOutcome> {
    const resume = session.delivered.length > 0
    const promptPath = join(await this.workspace(), `prompt-${turn}.json`)
    await writeFile(promptPath, promptFileBody(blocks), 'utf8')
    try {
      const argv = headlessTurnArgv({
        promptFile: promptPath,
        schemaJson: JSON.stringify(decisionSchemaFor(options.tools, auxiliary)),
        model: options.model,
        ...(options.reasoningEffort === undefined ? {} : { effort: String(options.reasoningEffort) }),
        system: transportSystemPrompt(),
        sessionId: session.id,
        resume,
        turnCap: this.config.vendorTurnCap,
      })

      const collected = await this.runCollected(argv, this.config.turnTimeoutMs, options.signal)
      const result = parseHeadlessResult(collected.stdout)
      return { result, exitCode: collected.exitCode, stderrText: collected.stderr }
    } finally {
      await rm(promptPath, { force: true }).catch(() => {})
    }
  }

  private turnFailure(
    settled: Exclude<ReturnType<typeof settlement>, { kind: 'success' }>,
    outcome: TurnOutcome,
  ): LlmError {
    if (settled.kind === 'cancelled') {
      // `ABORTED` is not a local invention: `dsh-llm` turns an adapter throw
      // carrying it into the stream's terminal `{ kind: 'aborted', failure }`
      // rather than `{ kind: 'error', failure }`, which is the documented
      // shape for a cancelled request.
      const failure = grokVendorFailure({
        stage: 'turn',
        stderrText: outcome.stderrText,
        category: 'cancelled',
        exitCode: outcome.exitCode,
      })
      return new LlmError('Grok Build CLI turn was cancelled.', 'ABORTED', { cause: failure })
    }
    if (settled.kind === 'max-tokens') {
      const failure = grokVendorFailure({
        stage: 'turn',
        stderrText: outcome.stderrText,
        category: 'max-tokens',
        exitCode: outcome.exitCode,
      })
      return new LlmError(
        'Grok Build CLI turn stopped at the model output cap before producing a decision.',
        'GROK_CLI',
        { cause: failure },
      )
    }
    const failure = grokVendorFailure({
      stage: 'turn',
      stderrText: outcome.stderrText,
      category: settled.category,
      exitCode: outcome.exitCode,
    })
    return new LlmError(`Grok Build CLI turn failed. ${failure.message}`, 'GROK_CLI', { cause: failure })
  }

  private combinedSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs)
    return parent === undefined ? timeout : AbortSignal.any([parent, timeout])
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

  /**
   * The vendor's own working directory for every child this route spawns.
   *
   * A throwaway directory rather than the user's repository, and that is a
   * capability decision rather than tidiness: the vendor discovers a project
   * root by walking up for a `.git` directory and then scopes `AGENTS.md`,
   * skills and git history to it. Pointed at the user's repo it would read
   * project instructions DSH did not ask for into a prompt DSH owns.
   */
  private async workspace(): Promise<string> {
    this.workspacePromise ??= mkdtemp(join(tmpdir(), 'dsh-grok-'))
    return await this.workspacePromise
  }

  private async runCollected(
    args: readonly string[],
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const cwd = await this.workspace()
    const signal = this.combinedSignal(parentSignal, timeoutMs)
    const invocation = await this.invocation(args, signal)
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn({
        argv: [...invocation.argv],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: MAX_TURN_STDOUT_BYTES },
          stderr: { maxBytes: this.config.stderrMaxBytes },
        },
        graceMs: this.config.disposeGraceMs,
        signal,
        // Explicit entries only. The subprocess runtime merges them onto its own
        // scrubbed parent base, so re-spreading that base here would turn every
        // ambient entry into a deliberate caller opt-in -- which is the documented
        // way a credential-shaped entry survives the scrub.
        env: { ...invocation.env },
      })
    } catch (error) {
      this.spawnFailure(error)
    }
    this.activeChildren.add(child)
    try {
      const outcome = await child.done
      const stdout = child.collected.stdout?.readFrom(0).text ?? ''
      const stderr = child.collected.stderr?.readFrom(0).text ?? ''
      if (signal.aborted) {
        if (parentSignal?.aborted) {
          throw parentSignal.reason instanceof Error
            ? parentSignal.reason
            : new Error(String(parentSignal.reason))
        }
        throw new LlmError(`Grok Build CLI command timed out after ${timeoutMs}ms`, 'GROK_CLI')
      }
      return { exitCode: outcome.exitCode, stdout, stderr }
    } catch (error) {
      this.spawnFailure(error)
    } finally {
      this.activeChildren.delete(child)
    }
  }

  /**
   * Map a spawn-time OS error onto a named adapter failure.
   *
   * `E2BIG` is the one that has already killed a real session: Linux refuses a
   * 128 KiB argv slot before `grok` starts, and the raw `spawn E2BIG` reached
   * the user as an unexplained process crash. Anything else is rethrown as-is
   * so a genuine programmer error is not relabelled.
   */
  private spawnFailure(error: unknown): never {
    if (isArgListTooLong(error)) {
      const failure = grokVendorFailure({
        stage: 'turn',
        stderrText: undefined,
        category: 'spawn-too-big',
      })
      throw new LlmError(
        'Grok Build CLI could not be spawned because the command line was too long.',
        'GROK_CLI',
        { cause: failure },
      )
    }
    throw error
  }

  private async models(signal?: AbortSignal): Promise<readonly CatalogModel[]> {
    const cached = this.cachedModels
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.models
    this.pendingModels ??= this.loadModels(signal).finally(() => {
      this.pendingModels = undefined
    })
    return await this.pendingModels
  }

  private async loadModels(signal?: AbortSignal): Promise<readonly CatalogModel[]> {
    const cwd = await this.workspace()
    const combined = this.combinedSignal(signal, this.config.catalogTimeoutMs)
    const invocation = await this.invocation(agentStdioArgv(), combined)
    const result = await readAcpInitialize({
      argv: invocation.argv,
      cwd,
      env: invocation.env,
      timeoutMs: this.config.catalogTimeoutMs,
      disposeGraceMs: this.config.disposeGraceMs,
      stderrMaxBytes: this.config.stderrMaxBytes,
      spawn: (spec) => this.ctx.subprocess.spawn(spec),
      signal: combined,
    })
    const models = parseCatalog(result)
    if (this.config.modelCacheMs > 0) {
      this.cachedModels = { expiresAt: Date.now() + this.config.modelCacheMs, models }
    }
    return models
  }
}
