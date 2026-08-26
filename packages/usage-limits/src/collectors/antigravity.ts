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
} from '../contract.js';

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

export interface AntigravityUsageCapabilitySource { readCapability(): Promise<AntigravityObservation>; }
export class AntigravityUnsupportedUsageSource implements AntigravityUsageCapabilitySource {
  async readCapability(): Promise<AntigravityCapabilityObservation> {
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

export class AntigravityUsageCollector {
  constructor(protected readonly source: AntigravityUsageCapabilitySource) {}

  async collect(observedAtMs: number): Promise<ProviderUsageSnapshot> {
    if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) {
      throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`);
    }
    let observation: AntigravityObservation;
    try {
      observation = await this.source.readCapability();
    } catch (err) {
      if (err instanceof AntigravityUsageSourceError) {
        return parseProviderUsageSnapshot({
          providerId: ANTIGRAVITY_PROVIDER_ID,
          displayName: ANTIGRAVITY_DISPLAY_NAME,
          status: err.code,
          observedAtMs,
          windows: [],
          source: defaultSourceMetadata(),
        });
      }
      return parseProviderUsageSnapshot({
        providerId: ANTIGRAVITY_PROVIDER_ID,
        displayName: ANTIGRAVITY_DISPLAY_NAME,
        status: 'ERROR',
        observedAtMs,
        windows: [],
        source: defaultSourceMetadata(),
      });
    }
    return normalizeAntigravityCapability(observation, observedAtMs);
  }
}
