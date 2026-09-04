/**
 * Turn usage arithmetic.
 *
 * `agy` reports `usage` accumulated over the whole conversation rather than
 * per turn -- published contract, not a quirk -- so a step's own figure is a
 * difference, and a baseline has to survive a turn that omits an optional
 * field. Both rules are small, both are easy to get wrong once, and neither
 * needs the adapter.
 *
 * @module nishi-dsh-antigravity/turn-usage
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { record } from './agy-vendor.js'

export function usageFrom(value: unknown): TokenUsage | undefined {
  const row = record(value)
  if (!row) return undefined
  const count = (key: string): number | undefined => {
    const candidate = row[key]
    return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : undefined
  }
  const input = count('input_tokens')
  const output = count('output_tokens')
  if (input === undefined || output === undefined) return undefined
  const cacheRead = count('cache_read_tokens')
  const reasoning = count('thinking_tokens')
  return {
    inputTokens: input,
    outputTokens: output,
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}

/**
 * Report what this turn spent, given what the conversation had spent before it.
 *
 * `agy` reports cumulative conversation totals, so a live child's second turn
 * restates the first one's tokens. DSH sums what an adapter reports, so the
 * running total has to become a difference here or the session's own meter --
 * and with it the compaction threshold and every usage figure the user sees --
 * counts the same tokens once per remaining step.
 *
 * Clamped at zero rather than trusted: a vendor that ever restarts or rebases
 * a counter mid-conversation would otherwise produce a negative field, and an
 * under-reported turn is a smaller lie than a negative one.
 */
export function usageSinceLastTurn(reported: TokenUsage, previous: TokenUsage | undefined): TokenUsage {
  if (previous === undefined) return reported
  const since = (now: number | undefined, before: number | undefined): number =>
    Math.max(0, (now ?? 0) - (before ?? 0))
  return {
    inputTokens: since(reported.inputTokens, previous.inputTokens),
    outputTokens: since(reported.outputTokens, previous.outputTokens),
    ...(reported.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: since(reported.cacheReadTokens, previous.cacheReadTokens) }),
    ...(reported.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: since(reported.reasoningTokens, previous.reasoningTokens) }),
  }
}

/**
 * Retain the last known cumulative total per field across turns.
 *
 * An optional token field (e.g. `cacheReadTokens`, `reasoningTokens`) omitted by
 * the vendor on one turn must preserve its previous baseline rather than reset
 * to undefined. Otherwise, a subsequent turn reporting that field again would
 * subtract against undefined and duplicate its earlier cumulative count.
 * Fields never reported remain undefined so no spurious baseline is invented.
 */
export function recordUsageBaseline(reported: TokenUsage, previous: TokenUsage | undefined): TokenUsage {
  if (previous === undefined) return reported
  const cacheRead = reported.cacheReadTokens ?? previous.cacheReadTokens
  const reasoning = reported.reasoningTokens ?? previous.reasoningTokens
  return {
    inputTokens: reported.inputTokens,
    outputTokens: reported.outputTokens,
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}
