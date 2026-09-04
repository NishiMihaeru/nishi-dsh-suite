/**
 * How one vendor turn ended, and what DSH reports when it did not end well.
 *
 * `agy` publishes seven `result` statuses and they are not seven shades of
 * one outcome; the classification and the diagnostic it produces are pure
 * functions of the envelope, and `test/turn-settlement.test.ts` already
 * treats them as a unit.
 *
 * @module nishi-dsh-antigravity/turn-settlement
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { AgyTurnResult } from './agy-session.js'
import { antigravityVendorFailure } from './vendor-stderr.js'

/** Whether vendor-authored text -- a turn error or dying stderr -- reports the effort flag as unsupported. */
export function isEffortUnsupportedText(text: string): boolean {
  return /--effort is not supported/i.test(text)
    || /effort.*not supported/i.test(text)
    || /invalid model selection.*--effort/i.test(text)
}

export function isEffortUnsupported(result: AgyTurnResult): boolean {
  return typeof result.error === 'string' && isEffortUnsupportedText(result.error)
}

/**
 * How one vendor turn settled, by the vendor's own published status.
 *
 * `agy` publishes seven -- `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`,
 * `INVALID`, `WAITING`, `RUNNING` (`docs/verification/agy-cli-contract.md`) --
 * and they are not seven shades of one outcome. This used to be a boolean
 * (`status === 'SUCCESS'`), which named the other six in a diagnostic string
 * and acted on none, and that collapse was wrong in both directions:
 * cancellation is not a turn failure, and `WAITING`/`RUNNING` in a terminal
 * `result` means the turn has NOT settled -- the opposite of the completed
 * failure it read as.
 */
export type TurnSettlement =
  | { readonly kind: 'success' }
  | { readonly kind: 'cancelled'; readonly status: string }
  | { readonly kind: 'unsettled'; readonly status: string }
  | { readonly kind: 'failed'; readonly status: string }

/** A settlement that cannot yield a decision; the three non-success kinds. */
export type UnusableSettlement = Exclude<TurnSettlement, { kind: 'success' }>

/**
 * Classify one `result` envelope.
 *
 * An unrecognised status -- a vendor addition, or the field missing outright
 * -- is `failed` rather than anything softer: an ending this adapter cannot
 * name, over input the vendor has already consumed, must not read as success.
 */
export function settlement(result: AgyTurnResult): TurnSettlement {
  const status = typeof result.status === 'string' ? result.status : String(result.status)
  switch (status) {
    case 'SUCCESS':
      return { kind: 'success' }
    case 'CANCELED':
    case 'INTERRUPTED':
      return { kind: 'cancelled', status }
    case 'WAITING':
    case 'RUNNING':
      return { kind: 'unsettled', status }
    default:
      return { kind: 'failed', status }
  }
}

/** How to name a non-success settlement in a diagnostic. */
export function settlementPhrase(settled: UnusableSettlement): string {
  switch (settled.kind) {
    case 'cancelled':
      return 'was cancelled'
    case 'unsettled':
      return 'did not settle'
    default:
      return 'failed'
  }
}

/**
 * The DSH failure code one non-success settlement reports under.
 *
 * `ABORTED` is not a local invention: `dsh-llm` turns an adapter throw
 * carrying it into the stream's terminal `{ kind: 'aborted', failure }`
 * instead of `{ kind: 'error', failure }`, which is the documented shape for
 * a cancelled request ("Every stream ends in exactly one terminal `finish`
 * chunk ... `{ kind: 'aborted', failure }` on cancellation", dsh-llm README).
 * Downstream that reaches telemetry severity and the ACP stop reason; the
 * agent loop itself still routes both through `agent/request-error`, so this
 * corrects what a cancellation is REPORTED as rather than pretending it
 * changes the loop's control flow.
 *
 * An unsettled turn is a protocol violation, not a vendor error: the vendor
 * put a non-terminal status in the one event documented to be terminal.
 */
export function settlementCode(settled: UnusableSettlement): string {
  switch (settled.kind) {
    case 'cancelled':
      return 'ABORTED'
    case 'unsettled':
      return 'ANTIGRAVITY_PROTOCOL'
    default:
      return 'ANTIGRAVITY_CLI'
  }
}

/**
 * result.error is vendor-authored free text like any other vendor output, so
 * it is sanitised here rather than forwarded -- this is the last of the five
 * sites in this package where a failed vendor process could otherwise leak
 * into an ordinary DSH diagnostic. `status` is a safe, caller-controlled
 * enum value and may still be named directly.
 *
 * Known cost, accepted the same way at the other four sites: until
 * `ANTIGRAVITY_STDERR_RECOGNIZERS` grows, an ordinary turn failure reports
 * an unrecognized category instead of the vendor's own words. Safe and
 * uninformative beats informative and leaking.
 */
export function resultFailure(result: AgyTurnResult, settled: UnusableSettlement, buildNote: string): LlmError {
  const failure = antigravityVendorFailure({
    stage: 'turn',
    stderrText: typeof result.error === 'string' ? result.error : undefined,
  })
  return new LlmError(
    `Antigravity CLI turn ${settlementPhrase(settled)} (status ${settled.status}).${buildNote} ${failure.message}`,
    settlementCode(settled),
    { cause: failure },
  )
}
