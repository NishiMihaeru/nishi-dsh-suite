/** Focused Claude Code stream-json decoder independent from the Agent SDK. */

export interface ClaudeStreamHooks {
  readonly onUsageInvalidated?: () => void
  readonly onPermissionDenied?: () => void
}

export interface ClaudeStreamResult {
  readonly text: string
  readonly stopReason: 'completed'
}

export interface ClaudeStreamFailureFacts {
  readonly stage: 'query-run'
  readonly category: string
}

export class ClaudeStreamFailure extends Error {
  readonly facts: ClaudeStreamFailureFacts

  constructor(category: string, cause?: unknown) {
    super(
      `subagent-claude-code: Product subagent failure (product: Claude Code; stage: query-run; category: ${category})`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'ClaudeStreamFailure'
    this.facts = { stage: 'query-run', category }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function safeHook(hook: (() => void) | undefined): void {
  try {
    hook?.()
  } catch {}
}

function assistantText(message: Record<string, unknown>): string {
  const payload = record(message.message)
  const content = Array.isArray(payload?.content) ? payload.content : []
  const parts: string[] = []
  for (const block of content) {
    const item = record(block)
    if (item?.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
    }
  }
  return parts.join('')
}

function failureCategory(subtype: unknown): string {
  switch (subtype) {
    case 'error_during_execution':
    case 'error_max_turns':
    case 'error_max_budget_usd':
    case 'error_max_structured_output_retries':
      return subtype
    default:
      return 'unknown'
  }
}

/**
 * Consume Claude Code `--output-format stream-json` lines and require one
 * terminal result. Assistant stream text is authoritative when present because
 * valid Claude Code runs may emit an empty terminal `result` field.
 */
export async function consumeClaudeStream(
  lines: AsyncIterable<string>,
  hooks: ClaudeStreamHooks = {},
): Promise<ClaudeStreamResult> {
  const assistantParts: string[] = []
  let terminalSeen = false
  let terminalFallback = ''

  for await (const line of lines) {
    if (line.trim().length === 0) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new ClaudeStreamFailure('protocol', error)
    }

    const message = record(parsed)
    if (!message || typeof message.type !== 'string') {
      throw new ClaudeStreamFailure('protocol')
    }

    if (message.type === 'rate_limit_event') {
      safeHook(hooks.onUsageInvalidated)
      continue
    }

    if (message.type === 'system' && message.subtype === 'permission_denied') {
      safeHook(hooks.onPermissionDenied)
      continue
    }

    if (message.type === 'assistant') {
      const text = assistantText(message)
      if (text.length > 0) assistantParts.push(text)
      continue
    }

    if (message.type !== 'result') continue

    terminalSeen = true
    if (message.subtype !== 'success' || message.is_error === true) {
      const detail = Array.isArray(message.errors)
        ? new Error(message.errors.map((value) => String(value)).join('; '))
        : undefined
      throw new ClaudeStreamFailure(failureCategory(message.subtype), detail)
    }

    terminalFallback = typeof message.result === 'string' ? message.result : ''
  }

  if (!terminalSeen) {
    throw new ClaudeStreamFailure('missing-result')
  }

  const streamed = assistantParts.join('')
  const text = streamed.trim().length > 0 ? streamed : terminalFallback
  if (text.trim().length === 0) {
    throw new ClaudeStreamFailure('invalid-success')
  }

  return { text, stopReason: 'completed' }
}
