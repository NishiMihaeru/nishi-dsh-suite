/**
 * The headless `--output-format json` envelope: how one turn's result is read,
 * how its spend becomes DSH token usage, and how its stop reason is classified.
 *
 * @module nishi-dsh-grok/headless-result
 */
import { LlmError, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { record } from './grok-vendor.js'

/** One parsed headless result envelope. */
export interface HeadlessResult {
  /** The reply text. With a forced schema this is the serialized decision. */
  readonly text: string
  /** Snake_case ACP/Messages stop token, when the envelope carried one. */
  readonly stopReason: string | undefined
  /** Vendor session id, which is the id this route minted for it. */
  readonly sessionId: string | undefined
  /** The schema-bound decision, when the vendor reported one as an object. */
  readonly structuredOutput: unknown
  /** Spend for this invocation alone. */
  readonly usage: TokenUsage | undefined
  /** The vendor's own error message, when the envelope is the error shape. */
  readonly errorMessage: string | undefined
  /**
   * Whether the vendor reported that the model produced no schema-bound output.
   *
   * Only whether, never what: the field is vendor-authored text and never
   * reaches a diagnostic. It is worth reading because it separates "the model
   * answered outside the schema" from every other way a turn can end without a
   * decision, and that distinction decides whether asking again would help.
   */
  readonly noStructuredOutput: boolean
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Map one invocation's `usage` object onto DSH's disjoint token buckets.
 *
 * The mapping is direct, and that is the whole point of this route's shape:
 * the vendor documents `usage.input_tokens` as UNCACHED input with cache hits
 * reported separately, which is already DSH's contract, and it reports per
 * invocation rather than per conversation. The sibling Antigravity route has
 * to subtract the previous turn's totals out of a running conversation count;
 * there is nothing to subtract here.
 *
 * `total_tokens` is dropped when the vendor flags the ledger incomplete: the
 * documented behaviour is that missing buckets fall back to `0` rather than
 * being marked absent, so an incomplete total would be a confident undercount.
 */
export function usageFrom(raw: unknown, incomplete: boolean): TokenUsage | undefined {
  const usage = record(raw)
  if (usage === undefined) return undefined

  const inputTokens = numeric(usage.input_tokens)
  const outputTokens = numeric(usage.output_tokens)
  if (inputTokens === undefined && outputTokens === undefined) return undefined

  const cacheReadTokens = numeric(usage.cache_read_input_tokens)
  const cacheWriteTokens = numeric(usage.cache_creation_input_tokens)
  const reasoningTokens = numeric(usage.reasoning_tokens)
  const totalTokens = incomplete ? undefined : numeric(usage.total_tokens)

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  }
}

/**
 * Parse one headless envelope.
 *
 * The vendor emits a single JSON object on stdout and keeps update notices and
 * logs on stderr, so the whole of stdout is one value. A `{"type":"error"}`
 * envelope is parsed rather than rejected: it carries the vendor's own message
 * and, on a prompt-level failure, frozen spend fields worth reporting.
 */
export function parseHeadlessResult(stdout: string): HeadlessResult {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    throw new LlmError('Grok CLI turn produced no output', 'GROK_PROTOCOL')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (cause) {
    throw new LlmError('Grok CLI turn produced output that is not JSON', 'GROK_PROTOCOL', { cause })
  }

  const envelope = record(parsed)
  if (envelope === undefined) {
    throw new LlmError('Grok CLI turn produced a non-object result envelope', 'GROK_PROTOCOL')
  }

  const incomplete = envelope.usage_is_incomplete === true
  const text = typeof envelope.text === 'string' ? envelope.text : ''
  const errorMessage = envelope.type === 'error' && typeof envelope.message === 'string'
    ? envelope.message
    : undefined

  return {
    text,
    stopReason: typeof envelope.stopReason === 'string' ? envelope.stopReason : undefined,
    sessionId: typeof envelope.sessionId === 'string' ? envelope.sessionId : undefined,
    // Two spellings, because the vendor uses one per output format and
    // documents only the other: the `json` envelope this route reads returns
    // `structuredOutput`, measured on `grok 1.0.13`, while the documented
    // `streaming-messages-json` `result` line carries `structured_output`
    // "snake_case, matching the schema". Reading both costs one `??` and
    // survives whichever the vendor settles on.
    structuredOutput: envelope.structuredOutput ?? envelope.structured_output,
    usage: usageFrom(envelope.usage, incomplete),
    errorMessage,
    noStructuredOutput: typeof envelope.structuredOutputError === 'string'
      && envelope.structuredOutputError.length > 0,
  }
}

/**
 * Where a decision is read from, given one result envelope.
 *
 * Two sources, in order, because the vendor documents `structured_output` for
 * one output format and this route uses another: the field is preferred when
 * present, and the reply text is parsed as the schema-bound JSON when it is
 * not. Falling back rather than failing is safe because the decision carries a
 * per-step stamp that is verified either way -- a payload read out of `text`
 * is still refused unless it was authored for this step.
 */
export function decisionPayload(result: HeadlessResult): unknown {
  const structured = result.structuredOutput
  if (record(structured) !== undefined) return structured
  if (typeof structured === 'string' && structured.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(structured)
      if (record(parsed) !== undefined) return parsed
    } catch {
      // Fall through to the reply text: a string that is not the decision
      // object is not a source, it is noise.
    }
  }
  const text = result.text.trim()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The vendor's stderr wording for an exhausted `--max-turns`, measured on 1.0.13. */
const MAX_TURNS_REACHED = /max turns reached/i

/** How one turn ended, in terms this route acts on. */
export type Settlement =
  | { readonly kind: 'success' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'failed'; readonly category: string }

/**
 * Classify a turn's ending.
 *
 * The vendor publishes its turn stop reasons as `end_turn`, `max_tokens`,
 * `max_turn_requests`, `refusal` and `cancelled`. Each gets its own kind
 * rather than collapsing into one failure, because they are not the same
 * event: a cancellation is not a failure of the turn, an output-cap stop is a
 * recoverable signal DSH already understands, and `max_turn_requests` on a
 * route that caps the vendor's rounds at a handful means the model tried to
 * run the vendor's own agent loop instead of answering.
 *
 * An absent or unrecognised stop reason settles as failed: an ending this
 * route cannot name, over input the vendor has already consumed, must not read
 * as success.
 */
export function settlement(
  result: HeadlessResult,
  exitCode: number | null,
  stderrText?: string,
): Settlement {
  if (result.errorMessage !== undefined) return { kind: 'failed', category: 'vendor-error' }
  switch (result.stopReason) {
    case 'end_turn':
      return { kind: 'success' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    case 'cancelled':
      // `cancelled` is the vendor's word for two different endings, and only
      // one of them is a cancellation. Exhausting `--max-turns` reports
      // `stopReason: "cancelled"` with `Error: max turns reached` on stderr --
      // measured on `grok 1.0.13` while diagnosing the first real DSH request.
      // Reporting that as ABORTED tells the DSH loop the user stopped the
      // turn, which is a lie about who ended it and hides the one condition
      // this route can actually do something about.
      return MAX_TURNS_REACHED.test(stderrText ?? '')
        ? { kind: 'failed', category: 'turn-cap' }
        : { kind: 'cancelled' }
    case 'refusal':
      return { kind: 'failed', category: 'refusal' }
    case 'max_turn_requests':
      return { kind: 'failed', category: 'turn-cap' }
    case undefined:
      return {
        kind: 'failed',
        category: exitCode === 0 ? 'unsettled' : 'process-failure',
      }
    default:
      return { kind: 'failed', category: 'unrecognized-stop-reason' }
  }
}
