/** Codex usage collector and normalizer. */
import {
  UsageContractError,
  parseProviderUsageSnapshot,
  type ProviderUsageSnapshot,
  type LimitWindow,
  type ExtraUsage,
  type UsageSourceMetadata,
  type LimitScope,
  type LimitWindowKind,
} from '../contract.js';

export const CODEX_PROVIDER_ID = 'codex';
export const CODEX_DISPLAY_NAME = 'Codex';
export const CODEX_COLLECTOR_ID = 'codex-rate-limits';
export const CODEX_COLLECTOR_VERSION = '0.1.0';
export const CODEX_CAPABILITY_CLASS = 'SUPPORTED_OFFICIAL';
export const CODEX_SOURCE_KIND = 'OFFICIAL_LOCAL_PROTOCOL';

const DECIMAL_STRING_REGEX = /^(0|[1-9]\d*)(\.\d+)?$/;

export type CodexRateLimitsSourceErrorCode = 'LOGIN_REQUIRED' | 'UNAVAILABLE' | 'ERROR';
export class CodexRateLimitsSourceError extends Error {
  readonly code: CodexRateLimitsSourceErrorCode;
  constructor(message: string, code: CodexRateLimitsSourceErrorCode = 'ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodexRateLimitsSourceError';
    this.code = code;
  }
}

export interface CodexRateLimitsSource { readRateLimits(): Promise<unknown>; }
interface ValidatedCreditsSnapshot { hasCredits: boolean; unlimited: boolean; balance?: string; }

function assertPlainObject(val: unknown, context: string): Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) throw new UsageContractError(`${context} must be a non-null plain object`);
  return val as Record<string, unknown>;
}
function assertOptionalPlainObject(val: unknown, context: string): Record<string, unknown> | undefined {
  if (val === undefined || val === null) return undefined;
  return assertPlainObject(val, context);
}
function assertOptionalBoolean(val: unknown, context: string): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'boolean') throw new UsageContractError(`${context} must be a boolean (got ${typeof val})`);
  return val;
}
function assertOptionalNonEmptyString(val: unknown, context: string): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string' || val.trim().length === 0) throw new UsageContractError(`${context} must be a non-empty string`);
  return val.trim();
}
function parsePercent(val: unknown, context: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100) throw new UsageContractError(`${context} must be a finite number between 0 and 100 inclusive (got ${val})`);
  return val;
}
function parseDurationMins(val: unknown, context: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || !Number.isSafeInteger(val) || val <= 0) throw new UsageContractError(`${context} must be a positive safe integer (got ${val})`);
  const ms = val * 60 * 1000;
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new UsageContractError(`${context} produced unsafe duration ms`);
  return ms;
}
function parseResetSeconds(val: unknown, context: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || !Number.isSafeInteger(val) || val < 0) throw new UsageContractError(`${context} must be a non-negative safe integer of Unix seconds (got ${val})`);
  const ms = val * 1000;
  if (!Number.isSafeInteger(ms) || ms < 0) throw new UsageContractError(`${context} produced unsafe reset timestamp ms`);
  return ms;
}
function defaultSourceMetadata(): UsageSourceMetadata {
  return { kind: CODEX_SOURCE_KIND, collectorId: CODEX_COLLECTOR_ID, collectorVersion: CODEX_COLLECTOR_VERSION, capabilityClass: CODEX_CAPABILITY_CLASS };
}
function classifyCodexWindow(windowDurationMins: number | undefined, defaultLabel: string): { kind: LimitWindowKind; label: string } {
  if (windowDurationMins === 300) return { kind: 'SHORT', label: '5-hour' };
  if (windowDurationMins === 10080) return { kind: 'WEEKLY', label: 'Weekly' };
  return { kind: 'OTHER', label: defaultLabel };
}
function normalizeRateLimitWindow(rawWin: unknown, id: string, defaultPositionalLabel: string, scope: LimitScope, context: string): LimitWindow {
  const obj = assertPlainObject(rawWin, context);
  if (obj.usedPercent === undefined || obj.usedPercent === null) throw new UsageContractError(`${context}.usedPercent is required`);
  const usedPercent = parsePercent(obj.usedPercent, `${context}.usedPercent`);
  let windowDurationMs: number | undefined;
  let durationMins: number | undefined;
  if (obj.windowDurationMins !== undefined && obj.windowDurationMins !== null) {
    windowDurationMs = parseDurationMins(obj.windowDurationMins, `${context}.windowDurationMins`);
    durationMins = obj.windowDurationMins as number;
  }
  let resetsAtMs: number | undefined;
  if (obj.resetsAt !== undefined && obj.resetsAt !== null) resetsAtMs = parseResetSeconds(obj.resetsAt, `${context}.resetsAt`);
  const { kind, label } = classifyCodexWindow(durationMins, defaultPositionalLabel);
  const winLabel = scope.kind === 'BUCKET' ? (scope.label ? `${scope.label} (${label})` : `${scope.id} (${label})`) : label;
  const win: LimitWindow = { id, label: winLabel, kind, usedPercent, scope };
  if (windowDurationMs !== undefined) win.windowDurationMs = windowDurationMs;
  if (resetsAtMs !== undefined) win.resetsAtMs = resetsAtMs;
  return win;
}
function validateCreditsSnapshot(raw: unknown, context: string): ValidatedCreditsSnapshot | undefined {
  if (raw === undefined || raw === null) return undefined;
  const obj = assertPlainObject(raw, context);
  if (typeof obj.hasCredits !== 'boolean') throw new UsageContractError(`${context}.hasCredits must be a boolean (got ${typeof obj.hasCredits})`);
  if (typeof obj.unlimited !== 'boolean') throw new UsageContractError(`${context}.unlimited must be a boolean (got ${typeof obj.unlimited})`);
  let balance: string | undefined;
  if (obj.balance !== undefined && obj.balance !== null) {
    if (typeof obj.balance !== 'string') throw new UsageContractError(`${context}.balance must be a string (got ${typeof obj.balance})`);
    const trimmed = obj.balance.trim();
    if (trimmed.length > 0) balance = trimmed;
  }
  return { hasCredits: obj.hasCredits, unlimited: obj.unlimited, balance };
}
function projectCodexCreditsToExtraUsage(credits: ValidatedCreditsSnapshot | undefined): ExtraUsage | undefined {
  if (!credits) return undefined;
  const extra: ExtraUsage = { enabled: credits.hasCredits };
  if (credits.balance !== undefined && DECIMAL_STRING_REGEX.test(credits.balance)) extra.remaining = credits.balance;
  return extra;
}

export function normalizeCodexRateLimits(payload: unknown, observedAtMs: number): ProviderUsageSnapshot {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`);
  const raw = assertPlainObject(payload, 'Codex rate-limits payload');
  const rateLimitsRaw = assertPlainObject(raw.rateLimits, 'rateLimits');
  assertOptionalNonEmptyString(rateLimitsRaw.limitId, 'rateLimits.limitId');
  assertOptionalNonEmptyString(rateLimitsRaw.limitName, 'rateLimits.limitName');
  assertOptionalPlainObject(rateLimitsRaw.individualLimit, 'rateLimits.individualLimit');
  assertOptionalBoolean(rateLimitsRaw.spendControlReached, 'rateLimits.spendControlReached');
  assertOptionalNonEmptyString(rateLimitsRaw.planType, 'rateLimits.planType');
  assertOptionalNonEmptyString(rateLimitsRaw.rateLimitReachedType, 'rateLimits.rateLimitReachedType');
  assertOptionalPlainObject(raw.rateLimitResetCredits, 'rateLimitResetCredits');
  const windows: LimitWindow[] = [];
  if (rateLimitsRaw.primary !== undefined && rateLimitsRaw.primary !== null) windows.push(normalizeRateLimitWindow(rateLimitsRaw.primary, 'primary', 'Primary', { kind: 'PROVIDER' }, 'rateLimits.primary'));
  if (rateLimitsRaw.secondary !== undefined && rateLimitsRaw.secondary !== null) windows.push(normalizeRateLimitWindow(rateLimitsRaw.secondary, 'secondary', 'Secondary', { kind: 'PROVIDER' }, 'rateLimits.secondary'));
  const byLimitId = assertOptionalPlainObject(raw.rateLimitsByLimitId, 'rateLimitsByLimitId');
  if (byLimitId) {
    for (const [mapKey, bucketVal] of Object.entries(byLimitId)) {
      if (!mapKey || mapKey.trim().length === 0) throw new UsageContractError('rateLimitsByLimitId contains an empty key');
      const bucketObj = assertPlainObject(bucketVal, `rateLimitsByLimitId["${mapKey}"]`);
      if (bucketObj.limitId !== undefined && bucketObj.limitId !== null) {
        if (typeof bucketObj.limitId !== 'string') throw new UsageContractError(`rateLimitsByLimitId["${mapKey}"].limitId must be a string (got ${typeof bucketObj.limitId})`);
        if (bucketObj.limitId.trim() !== mapKey) throw new UsageContractError(`rateLimitsByLimitId["${mapKey}"].limitId ("${bucketObj.limitId}") does not match canonical map key "${mapKey}"`);
      }
      assertOptionalNonEmptyString(bucketObj.limitName, `rateLimitsByLimitId["${mapKey}"].limitName`);
      assertOptionalPlainObject(bucketObj.individualLimit, `rateLimitsByLimitId["${mapKey}"].individualLimit`);
      assertOptionalBoolean(bucketObj.spendControlReached, `rateLimitsByLimitId["${mapKey}"].spendControlReached`);
      assertOptionalNonEmptyString(bucketObj.planType, `rateLimitsByLimitId["${mapKey}"].planType`);
      assertOptionalNonEmptyString(bucketObj.rateLimitReachedType, `rateLimitsByLimitId["${mapKey}"].rateLimitReachedType`);
      validateCreditsSnapshot(bucketObj.credits, `rateLimitsByLimitId["${mapKey}"].credits`);
      const limitName = typeof bucketObj.limitName === 'string' && bucketObj.limitName.trim().length > 0 ? bucketObj.limitName.trim() : undefined;
      const safeId = encodeURIComponent(mapKey);
      const bucketScope: LimitScope = { kind: 'BUCKET', id: mapKey, ...(limitName ? { label: limitName } : {}) };
      if (bucketObj.primary !== undefined && bucketObj.primary !== null) windows.push(normalizeRateLimitWindow(bucketObj.primary, `bucket:${safeId}:primary`, 'Primary', bucketScope, `rateLimitsByLimitId["${mapKey}"].primary`));
      if (bucketObj.secondary !== undefined && bucketObj.secondary !== null) windows.push(normalizeRateLimitWindow(bucketObj.secondary, `bucket:${safeId}:secondary`, 'Secondary', bucketScope, `rateLimitsByLimitId["${mapKey}"].secondary`));
    }
  }
  const extraUsage = projectCodexCreditsToExtraUsage(validateCreditsSnapshot(rateLimitsRaw.credits, 'rateLimits.credits'));
  const snapshot: ProviderUsageSnapshot = {
    providerId: CODEX_PROVIDER_ID,
    displayName: CODEX_DISPLAY_NAME,
    status: 'AVAILABLE',
    observedAtMs,
    windows,
    source: defaultSourceMetadata(),
  };
  if (extraUsage !== undefined) snapshot.extraUsage = extraUsage;
  return parseProviderUsageSnapshot(snapshot);
}

export class CodexUsageCollector {
  constructor(protected readonly source: CodexRateLimitsSource) {}
  async collect(observedAtMs: number): Promise<ProviderUsageSnapshot> {
    if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`);
    let payload: unknown;
    try {
      payload = await this.source.readRateLimits();
    } catch (err) {
      if (err instanceof CodexRateLimitsSourceError) {
        return parseProviderUsageSnapshot({ providerId: CODEX_PROVIDER_ID, displayName: CODEX_DISPLAY_NAME, status: err.code, observedAtMs, windows: [], source: defaultSourceMetadata() });
      }
      return parseProviderUsageSnapshot({ providerId: CODEX_PROVIDER_ID, displayName: CODEX_DISPLAY_NAME, status: 'ERROR', observedAtMs, windows: [], source: defaultSourceMetadata() });
    }
    return normalizeCodexRateLimits(payload, observedAtMs);
  }
}
