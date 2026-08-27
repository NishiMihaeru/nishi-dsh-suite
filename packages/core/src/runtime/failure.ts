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
  /** Safe HTTP status metadata when the vendor protocol exposes one. */
  readonly httpStatus?: number
  /** Process exit code; null means the process ended without one. */
  readonly exitCode?: number | null
  /** Process signal; null means the process ended without one. */
  readonly signal?: string | null
  readonly cause?: unknown
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`nishi-core: vendorFailure ${field} must be a non-empty string`)
  }
  return value
}

function optionalHttpStatus(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 100 || (value as number) > 599) {
    throw new Error('nishi-core: vendorFailure spec.httpStatus must be an integer between 100 and 599')
  }
  return value as number
}

function optionalExitCode(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('nishi-core: vendorFailure spec.exitCode must be a non-negative safe integer or null')
  }
  return value as number
}

function optionalSignal(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value
  return requireNonEmptyString(value, 'spec.signal')
}

/** One error shape shared by every vendor CLI bridge. */
export class VendorFailure extends Error {
  readonly product: string
  readonly stage: string
  readonly category: string
  readonly httpStatus: number | undefined
  readonly exitCode: number | null | undefined
  readonly signal: string | null | undefined

  constructor(spec: VendorFailureSpec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('nishi-core: vendorFailure spec must be a non-null object')
    }

    const product = requireNonEmptyString(spec.product, 'spec.product')
    const stage = requireNonEmptyString(spec.stage, 'spec.stage')
    const category = requireNonEmptyString(spec.category, 'spec.category')
    if (spec.detail !== undefined && typeof spec.detail !== 'string') {
      throw new Error('nishi-core: vendorFailure spec.detail must be a string when provided')
    }
    const httpStatus = optionalHttpStatus(spec.httpStatus)
    const exitCode = optionalExitCode(spec.exitCode)
    const signal = optionalSignal(spec.signal)
    const detail = spec.detail !== undefined && spec.detail.length > 0 ? ` ${spec.detail}` : ''

    super(
      `Vendor CLI failure (product: ${product}; stage: ${stage}; category: ${category}).${detail}`,
      spec.cause !== undefined ? { cause: spec.cause } : undefined,
    )
    this.name = 'VendorFailure'
    this.product = product
    this.stage = stage
    this.category = category
    this.httpStatus = httpStatus
    this.exitCode = exitCode
    this.signal = signal
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

function execRecognizer(pattern: RegExp, stderrText: string): RegExpExecArray | null {
  // RegExp instances carrying /g or /y mutate lastIndex on exec(). A
  // recognizer is declarative rather than a cursor, so matching must neither
  // depend on nor mutate caller-owned regex state. Clone it for each attempt:
  // every call starts at index 0 and repeated recognition is deterministic.
  return new RegExp(pattern.source, pattern.flags).exec(stderrText)
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
    if (!recognizer || typeof recognizer !== 'object' || Array.isArray(recognizer)) {
      throw new Error('nishi-core: vendor stderr recognizer must be a non-null object')
    }
    const category = requireNonEmptyString(recognizer.category, 'recognizer.category')
    if (!(recognizer.pattern instanceof RegExp)) {
      throw new Error('nishi-core: vendor stderr recognizer.pattern must be a RegExp')
    }
    if (typeof recognizer.message !== 'function') {
      throw new Error('nishi-core: vendor stderr recognizer.message must be a function')
    }
    const match = execRecognizer(recognizer.pattern, stderrText)
    if (!match) continue
    const message = recognizer.message(match)
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new Error('nishi-core: vendor stderr recognizer.message must return a non-empty string')
    }
    return { category, message }
  }
  return undefined
}
