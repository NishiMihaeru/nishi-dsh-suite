/**
 * Antigravity usage capability collector and normalizer.
 *
 * Normalizes Antigravity capability and numeric observations into provider-agnostic
 * ProviderUsageSnapshot domain models without fabricating quota metrics.
 */
import {
  UsageContractError,
  parseProviderUsageSnapshot,
  type ProviderUsageSnapshot,
  type ProviderUsageStatus,
  type UsageSourceMetadata,
  type LimitWindow,
  type LimitScope,
  type LimitScopeKind,
  type LimitWindowKind,
} from 'nishi-dsh-core/usage';
import { VendorUsageCollector, type VendorUsageSource, type VendorUsageCollectorSpec } from 'nishi-dsh-core/usage';

export const ANTIGRAVITY_PROVIDER_ID = 'antigravity';
export const ANTIGRAVITY_DISPLAY_NAME = 'Antigravity';
export const ANTIGRAVITY_COLLECTOR_ID = 'antigravity-usage-capability';
export const ANTIGRAVITY_COLLECTOR_VERSION = '0.1.0';
export const ANTIGRAVITY_CAPABILITY_CLASS = 'UNSUPPORTED_NUMERIC_USAGE';
export const ANTIGRAVITY_SOURCE_KIND = 'NO_SUPPORTED_MACHINE_READABLE_SOURCE';
export const ANTIGRAVITY_SUPPORTED_MACHINE_READABLE_NUMERIC_USAGE = false;
export const ANTIGRAVITY_RUNTIME_INTEGRATION = 'INTERNAL_LOCAL_READ_ONLY';

export type AntigravityObservationKind =
  | 'NUMERIC_USAGE_AVAILABLE'
  | 'NUMERIC_USAGE_UNSUPPORTED'
  | 'AUTHENTICATED_AVAILABLE'
  | 'LOGIN_REQUIRED'
  | 'UNAVAILABLE';

export interface AntigravityNumericWindowObservation {
  readonly windowKind: 'SHORT' | 'WEEKLY' | 'OTHER';
  readonly label: string;
  readonly scope?: 'PROVIDER' | 'MODEL' | 'BUCKET';
  readonly scopeId?: string;
  readonly usedPercent: number;
  readonly remainingPercent?: number;
  readonly resetsAtMs?: number;
  readonly windowDurationMs?: number;
  /**
   * The pool this window belongs to, as the VENDOR names it.
   *
   * Optional because it was unavailable for as long as quota came off a
   * private RPC, which is why {@link poolLabel} below derives one by
   * stripping cadence words from a window label and falling back to a bucket
   * id. That derivation is a guess with a good track record, not a fact: on
   * the published `/usage` payload it would render `gemini-weekly` as
   * "gemini" where the vendor itself says "Gemini Models". When these two
   * fields are present the guess is skipped entirely.
   */
  readonly poolLabel?: string;
  readonly poolId?: string;
}

export interface AntigravityNumericUsageObservation {
  readonly kind: 'NUMERIC_USAGE_AVAILABLE';
  readonly windows: readonly AntigravityNumericWindowObservation[];
  readonly sourceKind?: string;
}

export type AntigravityCapabilityObservationKind = Exclude<AntigravityObservationKind, 'NUMERIC_USAGE_AVAILABLE'>;
export interface AntigravityCapabilityObservation { readonly kind: AntigravityCapabilityObservationKind; }
export type AntigravityObservation = AntigravityCapabilityObservation | AntigravityNumericUsageObservation;

export type AntigravityUsageSourceErrorCode = 'LOGIN_REQUIRED' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'ERROR';
export class AntigravityUsageSourceError extends Error {
  readonly code: AntigravityUsageSourceErrorCode;
  constructor(message: string, code: AntigravityUsageSourceErrorCode = 'ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AntigravityUsageSourceError';
    this.code = code;
  }
}

export type AntigravityUsageCapabilitySource = VendorUsageSource<AntigravityObservation>;
export class AntigravityUnsupportedUsageSource implements AntigravityUsageCapabilitySource {
  async read(): Promise<AntigravityCapabilityObservation> {
    return { kind: 'NUMERIC_USAGE_UNSUPPORTED' };
  }
}

function assertPlainObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageContractError(`${context} must be a non-null plain object`);
  }
  return value as Record<string, unknown>;
}

function assertNoUnknownKeys(obj: Record<string, unknown>, allowedKeys: readonly string[], context: string): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new UsageContractError(`${context} contains unrecognized key "${key}"`);
  }
}

function defaultSourceMetadata(): UsageSourceMetadata {
  return {
    kind: ANTIGRAVITY_SOURCE_KIND,
    collectorId: ANTIGRAVITY_COLLECTOR_ID,
    collectorVersion: ANTIGRAVITY_COLLECTOR_VERSION,
    capabilityClass: ANTIGRAVITY_CAPABILITY_CLASS,
  };
}

function numericSourceMetadata(): UsageSourceMetadata {
  return {
    kind: 'INTERNAL_LOCAL_READ_ONLY',
    collectorId: ANTIGRAVITY_COLLECTOR_ID,
    collectorVersion: ANTIGRAVITY_COLLECTOR_VERSION,
    capabilityClass: 'NUMERIC_USAGE_AVAILABLE',
  };
}

/**
 * Strip cadence words from a vendor window label so it can name a pool:
 * "Gemini Session Limit" describes both a pool and a window, and only the
 * pool part belongs on the scope.
 */
function withoutCadence(value: string): string {
  return value
    .replace(/\b(?:5\s*-?\s*h(?:our)?s?|five\s*-?\s*hours?|weekly|week|7\s*-?\s*days?|session|short|limit|quota|remaining)\b/gi, ' ')
    .replace(/[·|:/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Display name for one vendor pool, or `undefined` to let the id stand in. */
function poolLabel(scopeId: string, windowLabel: string): string | undefined {
  const fromLabel = withoutCadence(windowLabel);
  if (fromLabel.length > 0) return fromLabel;
  const fromId = withoutCadence(scopeId.replace(/^legacy-/, '').replace(/-/g, ' '));
  return fromId.length > 0 ? fromId : undefined;
}

/**
 * Cadence-independent identity for one vendor pool.
 *
 * The vendor buckets quota per pool *and* per cadence, so one pool arrives as
 * several bucket ids -- `legacy-gemini-session` for the 5-hour window and a
 * separate id for the weekly one. The browser groups bucket windows by
 * `scope.id`, so using the raw bucket id there splits a single pool into one
 * group per cadence: the same pool listed twice, once with each window.
 *
 * The label was already cadence-stripped; the id was not, which is exactly
 * why the two disagreed. Both now come from the same stripped text, so they
 * cannot drift apart again. Two pools collapse into one only if their
 * cadence-free names are identical, in which case they were indistinguishable
 * to the reader anyway.
 *
 * `LimitWindow.id` keeps the raw bucket id: windows must stay unique per
 * cadence even when their pool is one.
 */
function poolScopeId(scopeId: string, label: string | undefined): string {
  const base = label ?? withoutCadence(scopeId.replace(/^legacy-/, '').replace(/-/g, ' '));
  const slug = base.toLowerCase().replace(/\s+/g, '-');
  return slug.length > 0 ? slug : scopeId;
}

export function normalizeAntigravityCapability(observation: unknown, observedAtMs: number): ProviderUsageSnapshot {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) {
    throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`);
  }

  const obj = assertPlainObject(observation, 'AntigravityObservation');
  const kind = obj.kind;
  if (typeof kind !== 'string') throw new UsageContractError('AntigravityObservation.kind must be a string');

  if (kind === 'NUMERIC_USAGE_AVAILABLE') {
    assertNoUnknownKeys(obj, ['kind', 'windows', 'sourceKind'], 'AntigravityNumericUsageObservation');
    if (!Array.isArray(obj.windows)) throw new UsageContractError('AntigravityNumericUsageObservation.windows must be an array');

    const validatedWindows: LimitWindow[] = obj.windows.map((w: unknown, idx: number) => {
      const wObj = assertPlainObject(w, `AntigravityNumericUsageObservation.windows[${idx}]`);
      const scopeKind = (wObj.scope as LimitScopeKind) ?? 'BUCKET';
      const scopeId = wObj.scopeId !== undefined && String(wObj.scopeId).trim().length > 0
        ? String(wObj.scopeId).trim()
        : `bucket-${idx}`;
      const scope: LimitScope = { kind: scopeKind, id: scopeId };
      if (scopeKind === 'BUCKET') {
        // The pool's display name is the vendor's business, not the
        // browser's: before rc.3 the client guessed it by matching
        // 'gemini' / 'claude' / 'gpt' against window labels, which meant
        // every new vendor pool needed a browser edit. Taking the vendor's
        // own group name when the source supplies one finishes that move --
        // the derivation below is now the fallback for a source that cannot.
        const given = typeof wObj.poolLabel === 'string' && wObj.poolLabel.trim().length > 0
          ? wObj.poolLabel.trim()
          : undefined;
        const label = given ?? poolLabel(scopeId, String(wObj.label ?? ''));
        if (label !== undefined) scope.label = label;
        const givenId = typeof wObj.poolId === 'string' && wObj.poolId.trim().length > 0
          ? wObj.poolId.trim()
          : undefined;
        scope.id = givenId ?? poolScopeId(scopeId, label);
      }
      const win: LimitWindow = {
        id: `antigravity-${scopeId}`,
        label: String(wObj.label ?? ''),
        kind: (wObj.windowKind as LimitWindowKind) ?? 'OTHER',
        usedPercent: Number(wObj.usedPercent),
        scope,
      };
      if (wObj.resetsAtMs !== undefined) win.resetsAtMs = Number(wObj.resetsAtMs);
      if (wObj.windowDurationMs !== undefined) win.windowDurationMs = Number(wObj.windowDurationMs);
      return win;
    });

    return parseProviderUsageSnapshot({
      providerId: ANTIGRAVITY_PROVIDER_ID,
      displayName: ANTIGRAVITY_DISPLAY_NAME,
      status: 'AVAILABLE',
      observedAtMs,
      windows: validatedWindows,
      source: numericSourceMetadata(),
    });
  }

  assertNoUnknownKeys(obj, ['kind'], 'AntigravityCapabilityObservation');
  let status: ProviderUsageStatus;
  switch (kind) {
    case 'NUMERIC_USAGE_UNSUPPORTED':
    case 'AUTHENTICATED_AVAILABLE':
      status = 'UNSUPPORTED';
      break;
    case 'LOGIN_REQUIRED':
      status = 'LOGIN_REQUIRED';
      break;
    case 'UNAVAILABLE':
      status = 'UNAVAILABLE';
      break;
    default:
      throw new UsageContractError(`Unrecognized Antigravity capability observation kind "${kind}"`);
  }

  return parseProviderUsageSnapshot({
    providerId: ANTIGRAVITY_PROVIDER_ID,
    displayName: ANTIGRAVITY_DISPLAY_NAME,
    status,
    observedAtMs,
    windows: [],
    source: defaultSourceMetadata(),
  });
}

const ANTIGRAVITY_COLLECTOR_SPEC: VendorUsageCollectorSpec<AntigravityObservation> = {
  providerId: ANTIGRAVITY_PROVIDER_ID,
  displayName: ANTIGRAVITY_DISPLAY_NAME,
  sourceMetadata: defaultSourceMetadata,
  sourceErrorCode: (err) => (err instanceof AntigravityUsageSourceError ? err.code : undefined),
  normalize: normalizeAntigravityCapability,
};

export class AntigravityUsageCollector extends VendorUsageCollector<AntigravityObservation> {
  constructor(source: AntigravityUsageCapabilitySource) {
    super(source, ANTIGRAVITY_COLLECTOR_SPEC);
  }
}
