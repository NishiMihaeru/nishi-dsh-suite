/**
 * One authored list of narrow, high-confidence Antigravity CLI stderr
 * conditions, shared by every place in this package that turns a failed
 * vendor process into a diagnostic.
 *
 * `nishi-dsh-core/runtime`'s `VendorFailure` contract is non-negotiable: raw
 * vendor stderr never reaches a diagnostic or DTO. A caller here recognises a
 * specific condition first — network reachability, or an unsupported model
 * selection — and only the recogniser's own authored message (never the
 * surrounding raw text) becomes part of the failure. Everything else is
 * reported as an unattributed category plus safe exit/signal metadata.
 *
 * Deliberately short: agy's own wording for conditions like login or
 * stored-credential failures is unverified, and guessing at it would risk a
 * confidently wrong diagnostic. Only two conditions are recognised here —
 * one platform-level (safe by construction, shared with Codex), one
 * confirmed against the real CLI's output.
 *
 * @module nishi-dsh-antigravity/vendor-stderr
 */
import {
  recognizeVendorStderr,
  vendorFailure,
  VendorFailure,
  type VendorStderrRecognizer,
} from 'nishi-dsh-core/runtime'

/** Human-facing vendor product name used across every Antigravity-owned VendorFailure. */
export const ANTIGRAVITY_VENDOR_PRODUCT = 'Antigravity CLI'

/**
 * Recognisers are tried in order; the first hit wins. Kept deliberately to
 * two conditions this provider can reliably name; each `message()` quotes
 * only a token pulled from the match itself, never the surrounding vendor
 * text.
 */
const ANTIGRAVITY_STDERR_RECOGNIZERS: readonly VendorStderrRecognizer[] = [
  {
    category: 'network-unavailable',
    pattern: /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET)\b/,
    message: (match) => `Antigravity CLI could not reach the network (${match[1] ?? match[0]}).`,
  },
  {
    category: 'model-unsupported',
    pattern: /invalid model selection/i,
    message: () => 'Antigravity CLI rejected the requested model or reasoning effort as unsupported.',
  },
]

export interface AntigravityVendorFailureSpec {
  /** Lifecycle stage the failure occurred in, e.g. 'model-discovery', 'turn'. */
  readonly stage: string
  /** Collected vendor stderr text, if any. Never copied into the resulting message unless recognised. */
  readonly stderrText: string | undefined
  readonly exitCode?: number | null
  readonly signal?: string | null
}

/**
 * Build one sanitised {@link VendorFailure} for a failed Antigravity CLI
 * process. Safe to embed in any diagnostic: `VendorFailure.message` never
 * contains raw stderr, only a recognised, caller-authored sentence or an
 * unattributed category plus process exit/signal metadata.
 */
export function antigravityVendorFailure(spec: AntigravityVendorFailureSpec): VendorFailure {
  const recognized = recognizeVendorStderr(spec.stderrText, ANTIGRAVITY_STDERR_RECOGNIZERS)
  return vendorFailure({
    product: ANTIGRAVITY_VENDOR_PRODUCT,
    stage: spec.stage,
    category: recognized?.category ?? 'unrecognized',
    ...(recognized === undefined ? {} : { detail: recognized.message }),
    ...(spec.exitCode === undefined ? {} : { exitCode: spec.exitCode }),
    ...(spec.signal === undefined ? {} : { signal: spec.signal }),
  })
}
