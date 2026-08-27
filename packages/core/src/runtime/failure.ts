/**
 * One error shape for vendor CLI failures.
 *
 * Security property, non-negotiable: raw vendor stderr is never forwarded
 * into a diagnostic or DTO. A caller that wants stderr-derived detail must
 * recognise a specific, known condition first (see `recognizeVendorStderr`)
 * — only the recognised, caller-authored message becomes part of the
 * failure. Everything else about a failed vendor turn is reported as an
 * unattributed category, never as the vendor's own words, so local paths and
 * vendor output cannot escape into diagnostics.
 *
 * @module nishi-dsh-core/runtime/failure
 */

export interface VendorFailureSpec {
  /** Human-facing vendor product name, e.g. 'Antigravity CLI'. */
  readonly product: string
  /** Lifecycle stage the failure occurred in, e.g. 'startup', 'turn'. */
  readonly stage: string
  /** Named failure category, e.g. 'permission-denied', 'timeout', 'provider-error'. */
  readonly category: string
  /** Optional caller-authored, already-sanitised detail. Never raw vendor stderr. */
  readonly detail?: string
  readonly cause?: unknown
}

/** One error shape shared by every vendor CLI bridge. */
export class VendorFailure extends Error {
  readonly product: string
  readonly stage: string
  readonly category: string

  constructor(spec: VendorFailureSpec) {
    if (typeof spec.product !== 'string' || spec.product.length === 0) {
      throw new Error('nishi-core: vendorFailure spec.product must be a non-empty string')
    }
    if (typeof spec.stage !== 'string' || spec.stage.length === 0) {
      throw new Error('nishi-core: vendorFailure spec.stage must be a non-empty string')
    }
    if (typeof spec.category !== 'string' || spec.category.length === 0) {
      throw new Error('nishi-core: vendorFailure spec.category must be a non-empty string')
    }
    const detail = spec.detail !== undefined && spec.detail.length > 0 ? ` ${spec.detail}` : ''
    super(
      `Product subagent failure (product: ${spec.product}; stage: ${spec.stage}; category: ${spec.category}).${detail}`,
      spec.cause !== undefined ? { cause: spec.cause } : undefined,
    )
    this.name = 'VendorFailure'
    this.product = spec.product
    this.stage = spec.stage
    this.category = spec.category
  }
}

/** Construct one {@link VendorFailure}. */
export function vendorFailure(spec: VendorFailureSpec): VendorFailure {
  return new VendorFailure(spec)
}

/**
 * One recognised stderr condition: a pattern and the message to report when
 * it matches. `message` receives the regexp match so it can quote a
 * recognised token (e.g. a permission name) — never the surrounding raw
 * text.
 */
export interface VendorStderrRecognizer {
  readonly category: string
  readonly pattern: RegExp
  message(match: RegExpExecArray): string
}

export interface RecognizedVendorStderr {
  readonly category: string
  readonly message: string
}

/**
 * Match vendor stderr text against an ordered list of recognisers, in
 * order, returning the first hit. Returns undefined for empty/absent
 * stderr or when nothing recognised it — callers should fall back to an
 * unattributed category in that case rather than forwarding the raw text.
 */
export function recognizeVendorStderr(
  stderrText: string | undefined,
  recognizers: readonly VendorStderrRecognizer[],
): RecognizedVendorStderr | undefined {
  if (typeof stderrText !== 'string' || stderrText.length === 0) return undefined
  for (const recognizer of recognizers) {
    const match = recognizer.pattern.exec(stderrText)
    if (match) return { category: recognizer.category, message: recognizer.message(match) }
  }
  return undefined
}
