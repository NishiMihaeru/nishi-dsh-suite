/** DSH message history mapping and durable Codex thread checkpoints. */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { projectedContentText } from './content-projection.js'

/** Replay data persisted on each successful DSH assistant message. */
export interface CodexReplayState {
  readonly kind: 'codex-app-server'
  readonly version: 1
  readonly threadId: string
  readonly turnId: string
  readonly sessionId: string
  /** DSH tool catalog persisted by the App Server thread, absent on older plugin checkpoints. */
  readonly toolSignature?: string
}

/** App Server text input for the current turn. */
export interface CodexTextInput {
  readonly type: 'text'
  readonly text: string
  readonly text_elements: readonly []
}

/** App Server inline image input for the current turn. */
export interface CodexImageInput {
  readonly type: 'image'
  readonly url: string
}

/** Resolve one durable DSH image reference to an App Server-safe inline URL. */
export type CodexImageUrlResolver = (attachment: ImageAttachmentRef) => Promise<string>

/** History work required before the current App Server turn starts. */
export interface PreparedCodexHistory {
  readonly checkpoint?: CodexReplayState
  readonly injectItems: readonly Record<string, unknown>[]
  readonly turnInput: readonly (CodexTextInput | CodexImageInput)[]
}

function replayState(value: unknown): CodexReplayState | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const candidate = (raw.response !== null && typeof raw.response === 'object' && !Array.isArray(raw.response))
    ? raw.response as Record<string, unknown>
    : raw
  if (candidate.kind !== 'codex-app-server' || candidate.version !== 1) return undefined
  if (typeof candidate.threadId !== 'string' || candidate.threadId.length === 0) return undefined
  if (typeof candidate.turnId !== 'string' || candidate.turnId.length === 0) return undefined
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0) return undefined
  return {
    kind: 'codex-app-server',
    version: 1,
    threadId: candidate.threadId,
    turnId: candidate.turnId,
    sessionId: candidate.sessionId,
    ...typeof candidate.toolSignature === 'string' && candidate.toolSignature.length > 0
      ? { toolSignature: candidate.toolSignature }
      : {},
  }
}

function latestCheckpoint(
  messages: readonly Message[],
  provider: string,
): { readonly index: number; readonly state: CodexReplayState } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || message.source.kind !== 'model' || message.source.provider !== provider) continue
    const state = replayState(message.source.replayState)
    if (state === undefined) {
      if (message.content.some(block => block.type === 'tool-call')) continue
      throw new Error(
        'codex-plugin-dsh: a prior Codex response has no compatible App Server checkpoint; start a new session',
      )
    }
    return { index, state }
  }
  return undefined
}

function textBlocks(blocks: readonly ContentBlock[], label: string): string[] {
  return blocks.map((block) => {
    if (block.type !== 'text') {
      throw new Error(`codex-plugin-dsh: ${label} contains unsupported ${JSON.stringify(block.type)} content`)
    }
    return block.text
  })
}

/**
 * A trailing non-tool user message is this turn's input rather than history.
 *
 * Content type does not enter the decision: blocks App Server input cannot
 * carry are projected to text (see {@link projectedContentText}). Deciding on
 * content instead would push a settlement notice whose last block is a
 * `tool-call` back into history, and a turn woken by nothing but that notice
 * would then have no input at all.
 */
function isCurrentTurnInput(message: Message): boolean {
  return message.role === 'user'
    && message.source.kind !== 'tool'
    && message.content.length > 0
}

/** A DSH tool message: the result of a call some earlier step made. */
function isToolResultMessage(message: Message): boolean {
  return message.role === 'user'
    && message.source.kind === 'tool'
    && message.content.length > 0
}

/**
 * Input for a turn whose only pending work is tool results.
 *
 * The active-turn path answers a Codex dynamic tool call with its own result
 * and never reaches this module. A turn arrives here holding nothing but tool
 * results when no Codex turn is open to answer: the step that made the calls
 * ran on another primary route, or the vendor turn was lost. Those results are
 * real work the model must see, so they become this turn's input rather than a
 * reason to fail it, and this line says why the input looks like that.
 */
const TOOL_RESULT_CONTINUATION_NOTICE =
  '[dsh: this turn continues from tool results produced outside the Codex thread]'

async function inputContent(
  blocks: readonly ContentBlock[],
  resolveImageUrl: CodexImageUrlResolver,
): Promise<Record<string, unknown>[]> {
  return Promise.all(blocks.map(async (block) => {
    if (block.type === 'text') return { type: 'input_text', text: block.text }
    if (block.type === 'image') {
      return { type: 'input_image', image_url: await resolveImageUrl(block.attachment) }
    }
    return { type: 'input_text', text: projectedContentText(block) }
  }))
}

async function toolOutput(
  block: Extract<ContentBlock, { type: 'tool-result' }>,
  resolveImageUrl: CodexImageUrlResolver,
): Promise<string | Record<string, unknown>[]> {
  const label = `tool result ${JSON.stringify(block.toolCallId)}`
  if (block.content.every(item => item.type === 'text')) {
    return textBlocks(block.content, label).join('\n')
  }
  return inputContent(block.content, resolveImageUrl)
}

async function userHistoryItem(
  message: Message,
  resolveImageUrl: CodexImageUrlResolver,
): Promise<Record<string, unknown>[]> {
  if (message.source.kind === 'tool') {
    if (message.content.length !== 1 || message.content[0]?.type !== 'tool-result') {
      throw new Error('codex-plugin-dsh: a DSH tool message has invalid tool-result content')
    }
    const block = message.content[0]
    return [{
      type: 'function_call_output',
      call_id: block.toolCallId,
      output: await toolOutput(block, resolveImageUrl),
    }]
  }
  return [{
    type: 'message',
    role: message.role,
    content: await inputContent(message.content, resolveImageUrl),
  }]
}

function assistantHistoryItems(message: Message): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  let text: Array<{ readonly type: 'output_text'; readonly text: string; readonly annotations: readonly [] }> = []
  const flushText = (): void => {
    if (text.length === 0) return
    items.push({ type: 'message', role: 'assistant', status: 'completed', content: text })
    text = []
  }
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        text.push({ type: 'output_text', text: block.text, annotations: [] })
        break
      case 'tool-call':
        flushText()
        items.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: block.arguments,
          status: 'completed',
        })
        break
      case 'reasoning':
        // Responses history cannot import provider reasoning. Durable DSH
        // history remains unchanged; fallback replay projects visible output
        // only when a vendor checkpoint cannot safely be reused.
        break
      case 'image':
      case 'tool-result':
        throw new Error(`codex-plugin-dsh: assistant history contains unsupported ${JSON.stringify(block.type)} content`)
      default:
        throw new Error('codex-plugin-dsh: assistant history contains a plugin-defined content block that App Server cannot import')
    }
  }
  flushText()
  return items
}

/** Map completed DSH history to raw Responses items accepted by `thread/inject_items`. */
export async function responseItems(
  messages: readonly Message[],
  resolveImageUrl: CodexImageUrlResolver,
): Promise<readonly Record<string, unknown>[]> {
  const items = await Promise.all(messages.map(async (message) => {
    if (message.role === 'assistant') return assistantHistoryItems(message)
    if (message.role === 'user' || message.role === 'system') return userHistoryItem(message, resolveImageUrl)
    throw new Error(`codex-plugin-dsh: unsupported history role ${JSON.stringify(message.role)}`)
  }))
  return items.flat()
}

/**
 * Split a DSH request into a pinned Codex checkpoint, completed history to import, and current user input.
 * A checkpoint is reusable only inside the DSH session that created it; otherwise visible durable history is rebuilt.
 * @param messages - Exact DSH provider message sequence for this request.
 * @param provider - Registered Codex provider route.
 * @param resolveImageUrl - Durable-image resolver for history projection.
 * @param expectedSessionId - Current DSH session id; mismatched checkpoints are never reused.
 * @param ignoreCheckpoint - Rebuild from DSH history instead of reusing a persisted Codex thread.
 * @returns Work required to construct the matching App Server thread.
 * @throws when the request carries neither turn input nor tool results to continue from.
 *
 * A request whose pending tail is tool results alone continues from them; see
 * {@link TOOL_RESULT_CONTINUATION_NOTICE}.
 */
export async function prepareCodexHistory(
  messages: readonly Message[],
  provider: string,
  resolveImageUrl: CodexImageUrlResolver,
  expectedSessionId?: string,
  ignoreCheckpoint = false,
): Promise<PreparedCodexHistory> {
  const checkpointCandidate = ignoreCheckpoint ? undefined : latestCheckpoint(messages, provider)
  const checkpoint = checkpointCandidate !== undefined
    && (expectedSessionId === undefined || checkpointCandidate.state.sessionId === expectedSessionId)
    ? checkpointCandidate
    : undefined
  const pending = checkpoint === undefined ? messages : messages.slice(checkpoint.index + 1)
  let inputStart = pending.length
  while (inputStart > 0 && isCurrentTurnInput(pending[inputStart - 1] as Message)) inputStart -= 1
  let historical: readonly Message[] = pending.slice(0, inputStart)
  let current: readonly Message[] = pending.slice(inputStart)
  let continuesFromToolResults = false
  if (current.length === 0) {
    let resultsStart = pending.length
    while (resultsStart > 0 && isToolResultMessage(pending[resultsStart - 1] as Message)) resultsStart -= 1
    if (resultsStart === pending.length) {
      throw new Error('codex-plugin-dsh: the current Codex turn has no user input')
    }
    // The results go in ONCE, in the imported history, where they pair with the
    // `function_call` items of the step that made them. They used to be sent as
    // turn input as well, because nothing had confirmed `thread/inject_items`
    // reaches the model at all; `test:live:inject-items` now shows it does, so
    // the repetition is dropped and the turn input is the notice alone.
    historical = pending
    current = []
    continuesFromToolResults = true
  }
  const projected = (await Promise.all(current.map(message => Promise.all(message.content.map(async (block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text, text_elements: [] as const }
    }
    if (block.type === 'image') {
      return { type: 'image' as const, url: await resolveImageUrl(block.attachment) }
    }
    return { type: 'text' as const, text: projectedContentText(block), text_elements: [] as const }
  }))))).flat()
  const turnInput = continuesFromToolResults
    ? [
        { type: 'text' as const, text: TOOL_RESULT_CONTINUATION_NOTICE, text_elements: [] as const },
        ...projected,
      ]
    : projected
  if (turnInput.every(input => input.type === 'text' && input.text.trim().length === 0)) {
    throw new Error('codex-plugin-dsh: the current Codex turn is empty')
  }
  return {
    ...checkpoint === undefined ? {} : { checkpoint: checkpoint.state },
    injectItems: await responseItems(historical, resolveImageUrl),
    turnInput,
  }
}
