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
 * Whether a settled-but-failed turn is worth asking for again on a rebuilt
 * conversation.
 *
 * This exists because an `ERROR` result on this route is **not always
 * terminal**, which was established from the vendor's own conversation store
 * rather than reasoned about. On 2026-09-04 a real turn (`agy 1.1.26`,
 * `gemini-3.8-flash` high) came back `ERROR` after its model call was shed
 * with `UNAVAILABLE (code 503)`; the vendor then injected its own recovery
 * message -- "The stream was interrupted. Please continue the task you were
 * working on." -- retried, and **recorded a valid, correctly stamped decision
 * for that same turn**, which DSH never saw because it had already read the
 * `ERROR` and killed the child. See `docs/verification/agy-cli-contract.md`,
 * finding 18.
 *
 * Retrying is safe on THIS route for a reason that is structural rather than
 * hopeful: the vendor executes nothing on DSH's behalf (the bridge agent is
 * `finish`-only, and every tool call is a proposal delivered to DSH), and a
 * failed turn has yielded nothing to DSH, because the decision is read
 * atomically after the result. So a repeated turn cannot repeat a side
 * effect. What it does cost is one vendor turn and the prefix cache, which is
 * why it happens once per step rather than in a loop.
 *
 * Narrow on purpose:
 *
 * - only `failed`, and within it only the vendor's own `ERROR`. `CANCELED` and
 *   `INTERRUPTED` are somebody's decision to stop, `WAITING`/`RUNNING` are a
 *   protocol violation, and `INVALID` is the vendor's word for input it will
 *   reject exactly as fast the second time;
 * - never on `turn-timeout`, the one `failed` category this route measures
 *   most often (`--print-timeout` expiry, finding 13): a retry there buys a
 *   second full `turnTimeoutMs` wait for the same slow answer;
 * - never on `model-unsupported` or an unsupported effort, both deterministic
 *   in the request rather than in the weather.
 *
 * Everything else -- including the unattributed category the 503 arrived as --
 * is retried, and deliberately without matching on the vendor's wording:
 * `result.error` is discarded before it reaches here, so a recogniser for the
 * 503 text would be a guess at a string this tree has never captured from an
 * envelope. The package's standing rule is that a recogniser needs a captured
 * string, so this decides on what IS known: the status, and the categories
 * already measured.
 */
const NON_RETRYABLE_TURN_CATEGORIES: ReadonlySet<string> = new Set(['turn-timeout', 'model-unsupported'])

export function isRetryableTurnFailure(settled: UnusableSettlement, result: AgyTurnResult): boolean {
  if (settled.kind !== 'failed' || settled.status !== 'ERROR') return false
  if (isEffortUnsupported(result)) return false
  const { category } = antigravityVendorFailure({
    stage: 'turn',
    stderrText: typeof result.error === 'string' ? result.error : undefined,
  })
  return !NON_RETRYABLE_TURN_CATEGORIES.has(category)
}

/**
 * The vendor's own conversation id for a failed turn, as a diagnostic clause.
 *
 * Named because the vendor keeps its side of every turn on disk -- a log at
 * `~/.gemini/antigravity-cli/log/cli-*.log` and a conversation store at
 * `~/.gemini/antigravity-cli/conversations/<id>.db`, whose `steps` table
 * carries the model's own block and the vendor's `error_details` -- and that
 * is the only place the vendor's own words for a failure survive, now that
 * `result.error` is sanitised away here by contract. Without this clause the
 * store has to be matched by wall-clock timestamp, which is ambiguous the
 * moment two DSH sessions run at once; finding 18 was diagnosed that way and
 * nearly attributed to the wrong process.
 *
 * Accepted only in canonical UUID form, which is what makes it safe to print
 * under the same rule that lets an exit code through: a value of that shape
 * cannot carry a path, a token or a sentence of vendor text.
 */
export function conversationNote(result: AgyTurnResult): string {
  const id = result.conversation_id
  if (typeof id !== 'string') return ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return ''
  return ` Vendor conversation ${id}.`
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
export function resultFailure(
  result: AgyTurnResult,
  settled: UnusableSettlement,
  buildNote: string,
  /**
   * One caller-authored sentence appended after the sanitised failure, for a
   * fact about DSH's own handling rather than about the vendor -- currently
   * only that the step had already been retried. Kept as a parameter rather
   * than wrapped by the caller so the `VendorFailure` stays the `cause`: the
   * whole suite asserts on that, and a wrapper would put an `LlmError` there.
   */
  note?: string,
): LlmError {
  const failure = antigravityVendorFailure({
    stage: 'turn',
    stderrText: typeof result.error === 'string' ? result.error : undefined,
  })
  return new LlmError(
    `Antigravity CLI turn ${settlementPhrase(settled)} (status ${settled.status}).${buildNote}`
    + `${conversationNote(result)} ${failure.message}${note === undefined ? '' : ` ${note}`}`,
    settlementCode(settled),
    { cause: failure },
  )
}
