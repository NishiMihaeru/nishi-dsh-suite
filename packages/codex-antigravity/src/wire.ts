/**
 * Minimal Codex app-server 0.147.0 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-codex/src/wire.ts
 *
 * @module dsh-subagent-codex-custom/wire
 */

import type { Readable, Writable } from 'node:stream'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import {
  CODEX_MEMORY_DYNAMIC_TOOL,
  type CodexSubagentMemory,
} from './memory.js'
import type { CodexPermissionMode } from './run.js'

export interface PromiseWithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

export function createPromiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Thread-start permission parameter bundles for each native mode. */
const THREAD_PERMISSION_PARAMS = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
} as const

interface StderrPermissionSignature {
  readonly text: string
  readonly request: string
  readonly decision: string
  readonly reason: string
}

const STDERR_PERMISSION_SIGNATURES: readonly StderrPermissionSignature[] = [
  {
    text: 'approval policy is Never; reject command',
    request: 'command execution',
    decision: 'denied',
    reason: 'Codex rejected an escalation because the selected policy never asks for approval',
  },
  {
    text: 'recorded sandbox violation:',
    request: 'sandbox execution',
    decision: 'failed',
    reason: 'Codex reported a sandbox violation',
  },
]

const STDERR_SIGNATURE_TAIL_CHARS =
  Math.max(...STDERR_PERMISSION_SIGNATURES.map((signature) => signature.text.length)) - 1

function stderrSignatureTail(value: string): string {
  for (let length = Math.min(STDERR_SIGNATURE_TAIL_CHARS, value.length); length > 0; length -= 1) {
    const tail = value.slice(-length)
    if (
      STDERR_PERMISSION_SIGNATURES.some(
        (signature) => tail.length < signature.text.length && signature.text.startsWith(tail),
      )
    ) {
      return tail
    }
  }
  return ''
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value
}

function unattendedDecision(params: Record<string, unknown>): 'decline' | 'cancel' {
  const available = params.availableDecisions
  if (available === undefined || available === null) return 'decline'
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  throw new Error('subagent-codex: app-server offered no unattended approval decision')
}

function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535
    ? value
    : undefined
}

function objectFailureInfo(value: Record<string, unknown>): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  const keys = Object.keys(value)
  const category = keys[0]
  if (keys.length !== 1 || category === undefined) return { category: 'unknown' }
  const detail = value[category]
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { category: 'unknown' }
  }
  const fields = detail as Record<string, unknown>
  switch (category) {
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts': {
      const httpStatus = numericHttpStatus(fields.httpStatusCode)
      return httpStatus === undefined ? { category } : { category, httpStatus }
    }
    case 'activeTurnNotSteerable':
      return { category }
    default:
      return { category: 'unknown' }
  }
}

function failureInfo(turn: Record<string, unknown>): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  if (turn.status !== 'failed') return { category: 'unknown' }
  const error = turn.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return { category: 'unknown' }
  }
  const info = (error as Record<string, unknown>).codexErrorInfo
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
      case 'usageLimitExceeded':
      case 'serverOverloaded':
      case 'cyberPolicy':
      case 'internalServerError':
      case 'unauthorized':
      case 'badRequest':
      case 'threadRollbackFailed':
      case 'sandboxError':
      case 'other':
        return { category: info }
      default:
        return { category: 'unknown' }
    }
  }
  return info !== null && typeof info === 'object' && !Array.isArray(info)
    ? objectFailureInfo(info as Record<string, unknown>)
    : { category: 'unknown' }
}

function unattendedDiagnostic(
  mode: CodexPermissionMode,
  request: string,
  decision: string,
  reason: string,
): string {
  return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`)
}

async function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    pending.catch(() => {})
    throw abortError(signal)
  }
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    rejectAbort(abortError(signal))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export type CodexWireFailureStage =
  | 'initialize'
  | 'thread-start'
  | 'turn-start'
  | 'turn'
  | 'process'
  | 'teardown'

export interface CodexWireFailureFacts {
  readonly stage: CodexWireFailureStage
  readonly category: string
  readonly httpStatus?: number | undefined
}

interface QueuedTurnNotification {
  readonly method: string
  readonly params: Record<string, unknown>
  readonly order: number
}

interface PendingDiagnostic {
  readonly order: number
  readonly request: string
  readonly decision: string
  readonly reason: string
}

export class CodexAppServerWire {
  private readonly input: Readable
  private readonly permissionMode: CodexPermissionMode
  private readonly projectMemory?: CodexSubagentMemory
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = createPromiseWithResolvers<never>()
  private threadId?: string
  private turnId?: string
  private pendingTurnId?: string
  private activeTurnSignal?: AbortSignal
  private turnCompleted?: PromiseWithResolvers<{
    params: Record<string, unknown>
    order: number
  }>
  private readonly earlyTurnNotifications: QueuedTurnNotification[] = []
  private lastFinalAnswer?: string
  private lastUnphasedAnswer?: string
  private diagnostic?: string
  private failure?: CodexWireFailureFacts
  private diagnosticOrder = 0
  private observationOrder = 0
  private pendingDiagnostic?: PendingDiagnostic
  private stderrTail = ''
  private inputEnded = false
  private terminalObserved = false
  private closed = false

  constructor(
    input: Readable,
    output: Writable,
    permissionMode: CodexPermissionMode,
    projectMemory?: CodexSubagentMemory,
  ) {
    this.input = input
    this.permissionMode = permissionMode
    this.projectMemory = projectMemory
    this.transport = new JsonRpcLineTransport(input, output)
    this.fatal.promise.catch(() => {})
    this.transport.onRequest((method, params) => this.handleServerRequest(method, params))
    this.transport.onNotification((method, params) => {
      try {
        this.handleNotification(method, params)
      } catch (error) {
        this.fail(thrown(error))
      }
    })
    this.input.on('error', this.onInputError)
    this.input.on('end', this.onInputEnd)
    output.on('error', this.onOutputError)
  }

  start(): void {
    this.transport.start()
  }

  endedBeforeTerminal(): boolean {
    return this.inputEnded && !this.terminalObserved
  }

  async initialize(signal: AbortSignal): Promise<void> {
    object(
      await this.guarded(
        this.transport.request(
          'initialize',
          {
            clientInfo: {
              name: 'deepseek-harness',
              title: 'DeepSeek Harness',
              version: '0.0.1',
            },
            capabilities: {
              experimentalApi: this.projectMemory !== undefined,
              requestAttestation: false,
            },
          },
          signal,
        ),
        signal,
      ),
      'initialize response',
    )
    this.transport.notify('initialized')
    await this.guarded(this.transport.flush(), signal)
  }

  async startThread(cwd: string, signal: AbortSignal): Promise<void> {
    const thread = object(
      object(
        await this.guarded(
          this.transport.request(
            'thread/start',
            {
              cwd,
              ephemeral: true,
              ...THREAD_PERMISSION_PARAMS[this.permissionMode],
              ...(this.projectMemory === undefined
                ? {}
                : { dynamicTools: [CODEX_MEMORY_DYNAMIC_TOOL] }),
            },
            signal,
          ),
          signal,
        ),
        'thread/start response',
      ).thread,
      'thread/start thread',
    )
    const id = string(thread.id, 'thread/start thread id')
    if (thread.ephemeral !== true) {
      throw new Error('subagent-codex: app-server did not create an ephemeral thread')
    }
    this.threadId = id
  }

  async runTurn(texts: readonly string[], signal: AbortSignal): Promise<SubagentResult> {
    const completion = createPromiseWithResolvers<{
      params: Record<string, unknown>
      order: number
    }>()
    this.turnCompleted = completion
    this.activeTurnSignal = signal
    const threadId = this.threadId
    const inputTexts =
      this.projectMemory?.bootstrap === null || this.projectMemory?.bootstrap === undefined
        ? [...texts]
        : [
            this.projectMemory.bootstrap,
            `# Delegated Task\n\n${texts[0] ?? ''}`,
            ...texts.slice(1),
          ]
    try {
      const turn = object(
        object(
          await this.guarded(
            this.transport.request(
              'turn/start',
              {
                threadId,
                input: inputTexts.map((text) => ({
                  type: 'text',
                  text,
                  text_elements: [],
                })),
              },
              signal,
            ),
            signal,
          ),
          'turn/start response',
        ).turn,
        'turn/start turn',
      )
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
    } catch (error) {
      this.activeTurnSignal = undefined
      this.recordFailure({ stage: 'turn-start', category: 'unknown' })
      throw error
    }

    let completed: { params: Record<string, unknown>; order: number }
    let terminal: Record<string, unknown>
    try {
      completed = await this.guarded(completion.promise, signal)
      terminal = object(completed.params.turn, 'turn/completed turn')
    } catch (error) {
      this.activeTurnSignal = undefined
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw error
    }
    this.activeTurnSignal = undefined

    const status = terminal.status
    if (status !== 'completed') {
      const parsed = failureInfo(terminal)
      this.recordFailure(
        parsed.httpStatus === undefined
          ? { stage: 'turn', category: parsed.category }
          : { stage: 'turn', category: parsed.category, httpStatus: parsed.httpStatus },
      )
      if (parsed.category === 'sandboxError') {
        this.recordDiagnostic(
          'sandbox execution',
          'failed',
          'Codex reported a sandbox failure',
          completed.order,
        )
      }
      if (parsed.category === 'contextWindowExceeded') {
        return { output: this.collectOutput(), stopReason: 'max-tokens' }
      }
      const detail = status === 'failed' ? `: ${parsed.category}` : ''
      throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`)
    }

    const output = this.collectOutput()
    if (output.length === 0) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw new Error('subagent-codex: Codex completed without a final answer')
    }

    return { output, stopReason: 'completed' }
  }

  interrupt(): void {
    if (this.threadId === undefined || this.turnId === undefined || this.closed) return
    this.transport
      .request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
      .catch(() => {})
  }

  collectOutput(): ContentBlock[] {
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return selected !== undefined && selected.trim().length > 0
      ? [{ type: 'text', text: selected }]
      : []
  }

  collectDiagnostic(): string | undefined {
    return this.diagnostic
  }

  collectFailure(): CodexWireFailureFacts {
    return this.failure ?? { stage: 'turn', category: 'unknown' }
  }

  observeStderr(chunk: string): void {
    const observed = `${this.stderrTail}${chunk}`
    let latestIndex = -1
    let latest: StderrPermissionSignature | undefined
    for (const signature of STDERR_PERMISSION_SIGNATURES) {
      const index = observed.lastIndexOf(signature.text)
      if (index > latestIndex) {
        latestIndex = index
        latest = signature
      }
    }
    if (latest !== undefined) {
      this.recordDiagnostic(latest.request, latest.decision, latest.reason)
    }
    this.stderrTail = stderrSignatureTail(observed)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.off('end', this.onInputEnd)
    this.transport.close()
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return raceAbort(Promise.race([this.fatal.promise, pending]), signal)
  }

  private fail(error: Error): void {
    this.fatal.reject(error)
  }

  private readonly onInputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onOutputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onInputEnd = (): void => {
    this.inputEnded = true
    this.fail(new Error('subagent-codex: app-server protocol stream closed'))
  }

  private observePendingTurnId(id: string): void {
    if (this.turnCompleted === undefined) {
      throw new Error('subagent-codex: app-server referenced a turn before turn/start')
    }
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: app-server referenced conflicting turns')
    }
    this.pendingTurnId = id
  }

  private commitTurnId(id: string): void {
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: turn/start response did not match the active turn')
    }
    this.turnId = id
    const pendingDiagnostic = this.pendingDiagnostic
    this.pendingDiagnostic = undefined
    if (pendingDiagnostic !== undefined) {
      this.recordDiagnostic(
        pendingDiagnostic.request,
        pendingDiagnostic.decision,
        pendingDiagnostic.reason,
        pendingDiagnostic.order,
      )
    }
    const notifications = this.earlyTurnNotifications.splice(0)
    for (const notification of notifications) {
      this.handleNotification(notification.method, notification.params, notification.order)
    }
  }

  private validateRunIds(params: Record<string, unknown>, nullableTurn = false): boolean {
    if (params.threadId !== this.threadId) {
      throw new Error('subagent-codex: app-server request referenced another thread')
    }
    if (nullableTurn && params.turnId === null) return false
    const id = string(params.turnId, 'server request turn id')
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      return true
    }
    if (id !== this.turnId) {
      throw new Error('subagent-codex: app-server request referenced another turn')
    }
    return false
  }

  private recordRequestDiagnostic(
    provisional: boolean,
    request: string,
    decision: string,
    reason: string,
  ): void {
    const order = this.nextObservationOrder()
    if (provisional) {
      this.pendingDiagnostic = { order, request, decision, reason }
      return
    }
    this.recordDiagnostic(request, decision, reason, order)
  }

  private recordDiagnostic(
    request: string,
    decision: string,
    reason: string,
    order = this.nextObservationOrder(),
  ): void {
    if (order < this.diagnosticOrder) return
    this.diagnosticOrder = order
    this.diagnostic = unattendedDiagnostic(this.permissionMode, request, decision, reason)
  }

  private recordFailure(facts: CodexWireFailureFacts): void {
    this.failure = facts
  }

  private nextObservationOrder(): number {
    this.observationOrder += 1
    return this.observationOrder
  }

  private recordDeclinedItem(item: Record<string, unknown>, order?: number): boolean {
    if (item.type === 'commandExecution' && item.status === 'declined') {
      this.recordDiagnostic(
        'command execution',
        'declined',
        'Codex declined the command under the selected permission mode',
        order,
      )
      return true
    }
    if (item.type === 'fileChange' && item.status === 'declined') {
      this.recordDiagnostic(
        'file change',
        'declined',
        'Codex declined the file change under the selected permission mode',
        order,
      )
      return true
    }
    return false
  }

  private handleDynamicMemoryCall(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const memory = this.projectMemory
    if (memory === undefined) {
      throw new Error('subagent-codex: dynamic project memory is unavailable')
    }
    this.validateRunIds(params)
    string(params.callId, 'dynamic tool call id')
    if (params.namespace !== null && params.namespace !== undefined) {
      throw new Error('subagent-codex: unsupported dynamic tool namespace')
    }
    if (string(params.tool, 'dynamic tool name') !== CODEX_MEMORY_DYNAMIC_TOOL.name) {
      throw new Error('subagent-codex: unsupported dynamic tool')
    }
    const args = object(params.arguments, 'dynamic tool arguments')
    const keys = Object.keys(args)
    if (keys.length !== 1 || typeof args.topic !== 'string' || args.topic.length === 0) {
      return Promise.resolve({
        contentItems: [{ type: 'inputText', text: 'DSH project memory read failed.' }],
        success: false,
      })
    }
    const signal = this.activeTurnSignal
    if (signal === undefined) {
      throw new Error('subagent-codex: dynamic tool call occurred outside an active turn')
    }
    return memory.read(args.topic, signal).then(
      (result) => ({
        contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
        success: true,
      }),
      () => ({
        contentItems: [{ type: 'inputText', text: 'DSH project memory read failed.' }],
        success: false,
      }),
    )
  }

  private handleServerRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      switch (method) {
        case 'item/tool/call':
          return this.handleDynamicMemoryCall(params)
        case 'item/commandExecution/requestApproval': {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'command approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/fileChange/requestApproval': {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'file approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/permissions/requestApproval':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'permission grant',
            'denied',
            'the provider grants no additional turn permissions',
          )
          return Promise.resolve({ permissions: {}, scope: 'turn' })
        case 'item/tool/requestUserInput':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'user input',
            'empty response',
            'the provider does not collect interactive answers',
          )
          return Promise.resolve({ answers: {} })
        case 'mcpServer/elicitation/request':
          this.recordRequestDiagnostic(
            this.validateRunIds(params, true),
            'MCP elicitation',
            'declined',
            'the provider does not collect interactive MCP input',
          )
          return Promise.resolve({ action: 'decline', content: null, _meta: null })
        default:
          throw new Error(
            `subagent-codex: unsupported app-server request ${JSON.stringify(method)}`,
          )
      }
    } catch (error) {
      const normalized = thrown(error)
      this.fail(normalized)
      return Promise.reject(normalized)
    }
  }

  private handleNotification(
    method: string,
    params: Record<string, unknown>,
    order?: number,
  ): void {
    if (method === 'turn/started') {
      if (string(params.threadId, 'turn/started thread id') !== this.threadId) return
      const turn = object(params.turn, 'turn/started turn')
      if (this.turnCompleted !== undefined && this.turnId === undefined) {
        this.observePendingTurnId(string(turn.id, 'turn/started turn id'))
      }
      return
    }
    if (method === 'item/completed') {
      if (string(params.threadId, 'item/completed thread id') !== this.threadId) return
      const id = string(params.turnId, 'item/completed turn id')
      if (this.turnId === undefined) {
        if (this.turnCompleted !== undefined) {
          this.observePendingTurnId(id)
          this.earlyTurnNotifications.push({
            method,
            params,
            order: this.nextObservationOrder(),
          })
        }
        return
      }
      if (id !== this.turnId) return
      const item = object(params.item, 'item/completed item')
      if (this.recordDeclinedItem(item, order)) return
      if (item.type !== 'agentMessage') return
      const text =
        typeof item.text === 'string'
          ? item.text
          : (() => {
              throw new Error('subagent-codex: app-server returned an invalid agent message')
            })()
      if (item.phase === 'final_answer') {
        this.lastFinalAnswer = text
      } else if (item.phase === null) {
        this.lastUnphasedAnswer = text
      } else if (item.phase !== 'commentary') {
        throw new Error(
          `subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`,
        )
      }
      return
    }
    if (method !== 'turn/completed') return
    if (string(params.threadId, 'turn/completed thread id') !== this.threadId) return
    const turn = object(params.turn, 'turn/completed turn')
    const id = string(turn.id, 'turn/completed turn id')
    const turnCompleted = this.turnCompleted
    if (turnCompleted === undefined) return
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      this.earlyTurnNotifications.push({
        method,
        params,
        order: this.nextObservationOrder(),
      })
      return
    }
    if (id !== this.turnId) return
    this.terminalObserved = true
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error(
        `subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`,
      )
    }
    turnCompleted.resolve({
      params,
      order: order ?? this.nextObservationOrder(),
    })
  }
}
