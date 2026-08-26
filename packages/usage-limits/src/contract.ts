/**
 * Provider-agnostic normalized Usage / Limits domain contract.
 */

export type ProviderUsageStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'LOGIN_REQUIRED'
  | 'UNSUPPORTED'
  | 'ERROR';

export const VALID_STATUSES: readonly ProviderUsageStatus[] = Object.freeze([
  'AVAILABLE',
  'UNAVAILABLE',
  'LOGIN_REQUIRED',
  'UNSUPPORTED',
  'ERROR',
]);

export type LimitWindowKind = 'SHORT' | 'WEEKLY' | 'OTHER';
export const VALID_WINDOW_KINDS: readonly LimitWindowKind[] = Object.freeze(['SHORT', 'WEEKLY', 'OTHER']);
export type LimitScopeKind = 'PROVIDER' | 'MODEL' | 'BUCKET';
export const VALID_SCOPE_KINDS: readonly LimitScopeKind[] = Object.freeze(['PROVIDER', 'MODEL', 'BUCKET']);

export interface LimitScope {
  kind: LimitScopeKind;
  id?: string;
  label?: string;
}

export interface LimitWindow {
  id: string;
  label: string;
  kind: LimitWindowKind;
  usedPercent?: number;
  resetsAtMs?: number;
  windowDurationMs?: number;
  scope?: LimitScope;
}

export interface ExtraUsage {
  enabled?: boolean;
  used?: string;
  limit?: string;
  remaining?: string;
  unit?: string;
}

export interface UsageSourceMetadata {
  kind?: string;
  collectorId?: string;
  collectorVersion?: string;
  capabilityClass?: string;
}

export interface ProviderUsageSnapshot {
  providerId: string;
  displayName: string;
  status: ProviderUsageStatus;
  observedAtMs: number;
  staleAtMs?: number;
  windows: LimitWindow[];
  extraUsage?: ExtraUsage;
  source?: UsageSourceMetadata;
}

export class UsageContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageContractError';
  }
}

const DECIMAL_STRING_REGEX = /^(0|[1-9]\d*)(\.\d+)?$/;

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

function assertNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UsageContractError(`${context} must be a non-empty string`);
  }
  return value.trim();
}

function assertNonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new UsageContractError(`${context} must be a non-negative finite integer number`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new UsageContractError(`${context} must be a positive finite integer number`);
  }
  return value;
}

function assertPercentage(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new UsageContractError(`${context} must be a finite number between 0 and 100 inclusive`);
  }
  return value;
}

function assertDecimalString(value: unknown, context: string): string {
  if (typeof value !== 'string' || !DECIMAL_STRING_REGEX.test(value)) {
    throw new UsageContractError(`${context} must be a valid non-negative decimal string (got "${String(value)}")`);
  }
  return value;
}

function parseLimitScope(raw: unknown, context: string): LimitScope {
  const obj = assertPlainObject(raw, context);
  assertNoUnknownKeys(obj, ['kind', 'id', 'label'], context);
  const kind = obj.kind;
  if (typeof kind !== 'string' || !VALID_SCOPE_KINDS.includes(kind as LimitScopeKind)) {
    throw new UsageContractError(`${context}.kind must be one of ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  const result: LimitScope = { kind: kind as LimitScopeKind };
  if (kind === 'MODEL' || kind === 'BUCKET') result.id = assertNonEmptyString(obj.id, `${context}.id for kind "${kind}"`);
  else if (obj.id !== undefined) result.id = assertNonEmptyString(obj.id, `${context}.id`);
  if (obj.label !== undefined) result.label = assertNonEmptyString(obj.label, `${context}.label`);
  return result;
}

function parseLimitWindow(raw: unknown, index: number): LimitWindow {
  const context = `windows[${index}]`;
  const obj = assertPlainObject(raw, context);
  assertNoUnknownKeys(obj, ['id', 'label', 'kind', 'usedPercent', 'resetsAtMs', 'windowDurationMs', 'scope'], context);
  const id = assertNonEmptyString(obj.id, `${context}.id`);
  const label = assertNonEmptyString(obj.label, `${context}.label`);
  const kind = obj.kind;
  if (typeof kind !== 'string' || !VALID_WINDOW_KINDS.includes(kind as LimitWindowKind)) {
    throw new UsageContractError(`${context}.kind must be one of ${VALID_WINDOW_KINDS.join(', ')}`);
  }
  const win: LimitWindow = { id, label, kind: kind as LimitWindowKind };
  if (obj.usedPercent !== undefined) win.usedPercent = assertPercentage(obj.usedPercent, `${context}.usedPercent`);
  if (obj.resetsAtMs !== undefined) win.resetsAtMs = assertNonNegativeInteger(obj.resetsAtMs, `${context}.resetsAtMs`);
  if (obj.windowDurationMs !== undefined) win.windowDurationMs = assertPositiveInteger(obj.windowDurationMs, `${context}.windowDurationMs`);
  if (obj.scope !== undefined) win.scope = parseLimitScope(obj.scope, `${context}.scope`);
  return win;
}

function assertExtraUsageConsistency(used: string, limit: string, remaining: string): void {
  const [usedInt, usedFrac = ''] = used.split('.');
  const [limitInt, limitFrac = ''] = limit.split('.');
  const [remInt, remFrac = ''] = remaining.split('.');
  const maxScale = Math.max(usedFrac.length, limitFrac.length, remFrac.length);
  const bigUsed = BigInt(usedInt + usedFrac.padEnd(maxScale, '0'));
  const bigLimit = BigInt(limitInt + limitFrac.padEnd(maxScale, '0'));
  const bigRem = BigInt(remInt + remFrac.padEnd(maxScale, '0'));
  if (bigUsed + bigRem !== bigLimit) {
    throw new UsageContractError(`extraUsage amounts are contradictory: used (${used}) + remaining (${remaining}) !== limit (${limit})`);
  }
}

function parseExtraUsage(raw: unknown): ExtraUsage {
  const context = 'extraUsage';
  const obj = assertPlainObject(raw, context);
  assertNoUnknownKeys(obj, ['enabled', 'used', 'limit', 'remaining', 'unit'], context);
  const extra: ExtraUsage = {};
  if (obj.enabled !== undefined) {
    if (typeof obj.enabled !== 'boolean') throw new UsageContractError(`${context}.enabled must be a boolean`);
    extra.enabled = obj.enabled;
  }
  if (obj.used !== undefined) extra.used = assertDecimalString(obj.used, `${context}.used`);
  if (obj.limit !== undefined) extra.limit = assertDecimalString(obj.limit, `${context}.limit`);
  if (obj.remaining !== undefined) extra.remaining = assertDecimalString(obj.remaining, `${context}.remaining`);
  if (obj.unit !== undefined) extra.unit = assertNonEmptyString(obj.unit, `${context}.unit`);
  if (extra.used !== undefined && extra.limit !== undefined && extra.remaining !== undefined) {
    assertExtraUsageConsistency(extra.used, extra.limit, extra.remaining);
  }
  return extra;
}

function parseUsageSourceMetadata(raw: unknown): UsageSourceMetadata {
  const context = 'source';
  const obj = assertPlainObject(raw, context);
  assertNoUnknownKeys(obj, ['kind', 'collectorId', 'collectorVersion', 'capabilityClass'], context);
  const source: UsageSourceMetadata = {};
  if (obj.kind !== undefined) source.kind = assertNonEmptyString(obj.kind, `${context}.kind`);
  if (obj.collectorId !== undefined) source.collectorId = assertNonEmptyString(obj.collectorId, `${context}.collectorId`);
  if (obj.collectorVersion !== undefined) source.collectorVersion = assertNonEmptyString(obj.collectorVersion, `${context}.collectorVersion`);
  if (obj.capabilityClass !== undefined) source.capabilityClass = assertNonEmptyString(obj.capabilityClass, `${context}.capabilityClass`);
  return source;
}

export function parseProviderUsageSnapshot(value: unknown): ProviderUsageSnapshot {
  const context = 'ProviderUsageSnapshot';
  const obj = assertPlainObject(value, context);
  assertNoUnknownKeys(obj, ['providerId', 'displayName', 'status', 'observedAtMs', 'staleAtMs', 'windows', 'extraUsage', 'source'], context);
  const providerId = assertNonEmptyString(obj.providerId, `${context}.providerId`);
  const displayName = assertNonEmptyString(obj.displayName, `${context}.displayName`);
  const status = obj.status;
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status as ProviderUsageStatus)) {
    throw new UsageContractError(`${context}.status must be one of ${VALID_STATUSES.join(', ')}`);
  }
  const validStatus = status as ProviderUsageStatus;
  const observedAtMs = assertNonNegativeInteger(obj.observedAtMs, `${context}.observedAtMs`);
  let staleAtMs: number | undefined;
  if (obj.staleAtMs !== undefined) {
    staleAtMs = assertNonNegativeInteger(obj.staleAtMs, `${context}.staleAtMs`);
    if (staleAtMs < observedAtMs) throw new UsageContractError(`${context}.staleAtMs (${staleAtMs}) cannot be earlier than observedAtMs (${observedAtMs})`);
  }
  if (!Array.isArray(obj.windows)) throw new UsageContractError(`${context}.windows must be an array`);
  const windows: LimitWindow[] = [];
  const seenWindowIds = new Set<string>();
  for (let i = 0; i < obj.windows.length; i++) {
    const win = parseLimitWindow(obj.windows[i], i);
    if (seenWindowIds.has(win.id)) throw new UsageContractError(`${context}.windows contains duplicate window id "${win.id}"`);
    seenWindowIds.add(win.id);
    windows.push(win);
  }
  let extraUsage: ExtraUsage | undefined;
  if (obj.extraUsage !== undefined) extraUsage = parseExtraUsage(obj.extraUsage);
  let source: UsageSourceMetadata | undefined;
  if (obj.source !== undefined) source = parseUsageSourceMetadata(obj.source);
  if (validStatus !== 'AVAILABLE') {
    if (windows.length > 0) throw new UsageContractError(`Non-AVAILABLE status "${validStatus}" must not contain active usage windows (got ${windows.length} windows)`);
    if (extraUsage && (extraUsage.used !== undefined || extraUsage.limit !== undefined || extraUsage.remaining !== undefined)) {
      throw new UsageContractError(`Non-AVAILABLE status "${validStatus}" must not contain active extraUsage data`);
    }
  }
  const snapshot: ProviderUsageSnapshot = { providerId, displayName, status: validStatus, observedAtMs, windows };
  if (staleAtMs !== undefined) snapshot.staleAtMs = staleAtMs;
  if (extraUsage !== undefined) snapshot.extraUsage = extraUsage;
  if (source !== undefined) snapshot.source = source;
  return snapshot;
}

export function validateProviderUsageSnapshot(value: unknown): void {
  parseProviderUsageSnapshot(value);
}

export function remainingPercent(usedPercent: number): number {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    throw new UsageContractError(`usedPercent must be a finite number between 0 and 100 inclusive (got ${usedPercent})`);
  }
  return 100 - usedPercent;
}

export function isUsageSnapshotStale(snapshot: ProviderUsageSnapshot, nowMs: number): boolean {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || !Number.isInteger(nowMs) || nowMs < 0) {
    throw new UsageContractError(`nowMs must be a non-negative finite integer number (got ${nowMs})`);
  }
  if (snapshot.staleAtMs === undefined) return false;
  return nowMs >= snapshot.staleAtMs;
}
