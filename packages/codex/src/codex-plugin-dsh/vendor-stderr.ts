/**
 * One authored list of narrow, high-confidence Codex CLI/App Server stderr
 * conditions, shared by every place in this package that turns a failed
 * vendor process into a diagnostic.
 *
 * `nishi-dsh-core/runtime`'s `VendorFailure` contract is non-negotiable: raw
 * vendor stderr never reaches a diagnostic or DTO. A caller here recognises a
 * specific condition first — login, stored-credential access, or network
 * reachability — and only the recogniser's own authored message (never the
 * surrounding raw text) becomes part of the failure. Everything else is
 * reported as an unattributed category plus safe exit/signal metadata.
 *
 * @module nishi-dsh-codex/codex-plugin-dsh/vendor-stderr
 */
import {
  recognizeVendorStderr,
  vendorFailure,
  VendorFailure,
  type VendorStderrRecognizer,
} from 'nishi-dsh-core/runtime'

/** Human-facing vendor product name used across every Codex-owned VendorFailure. */
export const CODEX_VENDOR_PRODUCT = 'Codex CLI'

/**
 * Recognisers are tried in order; the first hit wins. Kept deliberately
 * short: three conditions this provider can reliably name beat guessing at
 * ten more, and each `message()` quotes only a token pulled from the match
 * itself, never the surrounding vendor text.
 */
const CODEX_STDERR_RECOGNIZERS: readonly VendorStderrRecognizer[] = [
  {
    category: 'login-required',
    pattern: /\bnot logged in\b|\bcodex login\b/i,
    message: () => 'Codex CLI reported that sign-in is required; run `codex login` on the DSH host.',
  },
  {
    category: 'credentials-access-denied',
    pattern: /\b(EACCES|EPERM)\b[^\n]{0,160}auth\.json|auth\.json[^\n]{0,160}\b(EACCES|EPERM)\b/i,
    message: () => 'Codex CLI was denied access to its stored credentials.',
  },
  {
    category: 'network-unavailable',
    pattern: /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET)\b/,
    message: (match) => `Codex CLI could not reach the network (${match[1] ?? match[0]}).`,
  },
]

export interface CodexVendorFailureSpec {
  /** Lifecycle stage the failure occurred in, e.g. 'app-server', 'web-search'. */
  readonly stage: string
  /** Collected vendor stderr text, if any. Never copied into the resulting message unless recognised. */
  readonly stderrText: string | undefined
  readonly exitCode?: number | null
  readonly signal?: string | null
}

/**
 * Build one sanitised {@link VendorFailure} for a failed Codex CLI/App Server
 * process. Safe to embed in any diagnostic: `VendorFailure.message` never
 * contains raw stderr, only a recognised, caller-authored sentence or an
 * unattributed category plus process exit/signal metadata.
 */
export function codexVendorFailure(spec: CodexVendorFailureSpec): VendorFailure {
  const recognized = recognizeVendorStderr(spec.stderrText, CODEX_STDERR_RECOGNIZERS)
  return vendorFailure({
    product: CODEX_VENDOR_PRODUCT,
    stage: spec.stage,
    category: recognized?.category ?? 'unrecognized',
    ...(recognized === undefined ? {} : { detail: recognized.message }),
    ...(spec.exitCode === undefined ? {} : { exitCode: spec.exitCode }),
    ...(spec.signal === undefined ? {} : { signal: spec.signal }),
  })
}
