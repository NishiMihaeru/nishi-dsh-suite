/**
 * One authored list of narrow, high-confidence Grok Build CLI stderr
 * conditions, shared by every place in this package that turns a failed vendor
 * process into a diagnostic.
 *
 * `nishi-dsh-core/runtime`'s `VendorFailure` contract is non-negotiable: raw
 * vendor stderr never reaches a diagnostic or DTO. A caller here recognises a
 * specific condition first, and only the recogniser's own authored message
 * becomes part of the failure. Everything else is reported as an unattributed
 * category plus safe exit/signal metadata.
 *
 * Deliberately short. This vendor writes update notices and `RUST_LOG` output
 * to stderr on ordinary successful runs, so stderr here is not evidence of
 * failure at all -- it is read only once a turn has already failed, and only
 * for a condition that can be named. Guessing at wording for login or
 * credential failures would risk a confidently wrong diagnostic.
 *
 * @module nishi-dsh-grok/vendor-stderr
 */
import {
  recognizeVendorStderr,
  vendorFailure,
  VendorFailure,
  type VendorStderrRecognizer,
} from 'nishi-dsh-core/runtime'

/** Human-facing vendor product name used across every Grok-owned VendorFailure. */
export const GROK_VENDOR_PRODUCT = 'Grok Build CLI'

const GROK_STDERR_RECOGNIZERS: readonly VendorStderrRecognizer[] = [
  {
    // Platform-level and safe by construction: these tokens are emitted by the
    // OS resolver rather than authored by the vendor, and the same recogniser
    // is shared with the Codex and Antigravity routes.
    category: 'network-unavailable',
    pattern: /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET)\b/,
    message: (match) => `Grok Build CLI could not reach the network (${match[1] ?? match[0]}).`,
  },
  {
    // Measured on `grok 1.0.13`: `grok agent --always-approve stdio` exits
    // printing exactly this, because `/etc/grok/requirements.toml` on that
    // machine pins `disable_bypass_permissions_mode = true`. This route never
    // passes that flag -- it executes every tool in DSH -- so the recogniser
    // exists to name the condition if a managed policy ever refuses a flag
    // this route does pass, rather than to excuse one it needs.
    category: 'managed-policy',
    pattern: /disabled by managed policy/i,
    message: () => 'Grok Build CLI refused a flag its managed policy disables.',
  },
]

export interface GrokVendorFailureSpec {
  /** Lifecycle stage the failure occurred in, e.g. 'model-discovery', 'turn'. */
  readonly stage: string
  /** Collected vendor stderr text, if any. Never copied into the message unless recognised. */
  readonly stderrText: string | undefined
  /** A category this package already determined from the vendor's own result envelope. */
  readonly category?: string
  readonly exitCode?: number | null
  readonly signal?: string | null
}

/**
 * Build one sanitised {@link VendorFailure} for a failed Grok Build CLI
 * process.
 *
 * A caller-supplied `category` wins over stderr recognition, and that ordering
 * is deliberate: this vendor reports how a turn ended in a structured
 * `stopReason` field, which is a better source than text scraping, so a
 * settlement this package has already classified must not be relabelled by a
 * stray line of log output.
 */
export function grokVendorFailure(spec: GrokVendorFailureSpec): VendorFailure {
  const recognized = recognizeVendorStderr(spec.stderrText, GROK_STDERR_RECOGNIZERS)
  return vendorFailure({
    product: GROK_VENDOR_PRODUCT,
    stage: spec.stage,
    category: spec.category ?? recognized?.category ?? 'unrecognized',
    ...(recognized === undefined ? {} : { detail: recognized.message }),
    ...(spec.exitCode === undefined ? {} : { exitCode: spec.exitCode }),
    ...(spec.signal === undefined ? {} : { signal: spec.signal }),
  })
}
