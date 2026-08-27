import {
  UsageContractError,
  parseProviderUsageSnapshot,
  remainingPercent,
  type ProviderUsageSnapshot,
} from './contract.js';

export type PublicUsageStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'LOGIN_REQUIRED' | 'UNSUPPORTED' | 'ERROR';
export const VALID_PUBLIC_STATUSES: readonly PublicUsageStatus[] = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'LOGIN_REQUIRED', 'UNSUPPORTED', 'ERROR']);
export type PublicUsageFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';
export const VALID_PUBLIC_FRESHNESSES: readonly PublicUsageFreshness[] = Object.freeze(['FRESH', 'STALE', 'UNKNOWN']);
export type PublicLimitWindowKind = 'SHORT' | 'WEEKLY' | 'OTHER';
export const VALID_PUBLIC_WINDOW_KINDS: readonly PublicLimitWindowKind[] = Object.freeze(['SHORT', 'WEEKLY', 'OTHER']);
export type PublicLimitScopeKind = 'PROVIDER' | 'MODEL' | 'BUCKET';
export const VALID_PUBLIC_SCOPE_KINDS: readonly PublicLimitScopeKind[] = Object.freeze(['PROVIDER', 'MODEL', 'BUCKET']);

export interface PublicUsageScope {
  kind: PublicLimitScopeKind;
  id?: string;
  label?: string;
}

export interface PublicLimitWindow {
  id: string;
  label: string;
  kind: PublicLimitWindowKind;
  usedPercent: number;
  remainingPercent: number;
  resetsAtMs?: number;
  windowDurationMs?: number;
  scope?: PublicUsageScope;
}

export interface PublicExtraUsage {
  enabled?: boolean;
  used?: string;
  limit?: string;
  remaining?: string;
  unit?: string;
}

export interface PublicProviderUsage {
  providerId: string;
  displayName: string;
  status: PublicUsageStatus;
  observedAtMs: number;
  staleAtMs?: number;
  freshness: PublicUsageFreshness;
  windows: PublicLimitWindow[];
  extraUsage?: PublicExtraUsage;
}

export interface UsageLimitsPublicServiceLike {
  getRegisteredProviderIds(): readonly string[];
  getCachedSnapshot(providerId: string): ProviderUsageSnapshot | undefined;
  refreshProvider(providerId: string, options?: { force?: boolean }): Promise<ProviderUsageSnapshot>;
}

export type PublicProjectionClock = () => number;
export interface PublicRefreshProviderOptions { force?: boolean; }

const DECIMAL_STRING_REGEX = /^(0|[1-9]\d*)(\.\d+)?$/;

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UsageContractError(`${context} must be a non-null plain object`);
  return value as Record<string, unknown>;
}
function keys(obj: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const set = new Set(allowed);
  for (const key of Object.keys(obj)) if (!set.has(key)) throw new UsageContractError(`${context} contains unrecognized key "${key}"`);
}
function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new UsageContractError(`${context} must be a non-empty string`);
  return value.trim();
}
function nonNegativeInt(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) throw new UsageContractError(`${context} must be a non-negative finite safe integer number`);
  return value;
}
function positiveInt(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) throw new UsageContractError(`${context} must be a positive finite safe integer number`);
  return value;
}
function percent(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new UsageContractError(`${context} must be a finite number between 0 and 100 inclusive`);
  return value;
}
function decimal(value: unknown, context: string): string {
  if (typeof value !== 'string' || !DECIMAL_STRING_REGEX.test(value)) throw new UsageContractError(`${context} must be a valid non-negative decimal string (got "${String(value)}")`);
  return value;
}
function checkAmounts(used: string, limit: string, remaining: string): void {
  const [ui, uf = ''] = used.split('.');
  const [li, lf = ''] = limit.split('.');
  const [ri, rf = ''] = remaining.split('.');
  const scale = Math.max(uf.length, lf.length, rf.length);
  if (BigInt(ui + uf.padEnd(scale, '0')) + BigInt(ri + rf.padEnd(scale, '0')) !== BigInt(li + lf.padEnd(scale, '0'))) {
    throw new UsageContractError(`extraUsage amounts are contradictory: used (${used}) + remaining (${remaining}) !== limit (${limit})`);
  }
}

function parseScope(raw: unknown, context: string): PublicUsageScope {
  const obj = object(raw, context);
  keys(obj, ['kind', 'id', 'label'], context);
  if (typeof obj.kind !== 'string' || !VALID_PUBLIC_SCOPE_KINDS.includes(obj.kind as PublicLimitScopeKind)) throw new UsageContractError(`${context}.kind must be one of ${VALID_PUBLIC_SCOPE_KINDS.join(', ')}`);
  const scope: PublicUsageScope = { kind: obj.kind as PublicLimitScopeKind };
  if (scope.kind === 'MODEL' || scope.kind === 'BUCKET') scope.id = string(obj.id, `${context}.id for kind "${scope.kind}"`);
  else if (obj.id !== undefined) scope.id = string(obj.id, `${context}.id`);
  if (obj.label !== undefined) scope.label = string(obj.label, `${context}.label`);
  return scope;
}

function parseWindow(raw: unknown, index: number): PublicLimitWindow {
  const context = `windows[${index}]`;
  const obj = object(raw, context);
  keys(obj, ['id', 'label', 'kind', 'usedPercent', 'remainingPercent', 'resetsAtMs', 'windowDurationMs', 'scope'], context);
  if (typeof obj.kind !== 'string' || !VALID_PUBLIC_WINDOW_KINDS.includes(obj.kind as PublicLimitWindowKind)) throw new UsageContractError(`${context}.kind must be one of ${VALID_PUBLIC_WINDOW_KINDS.join(', ')}`);
  const used = percent(obj.usedPercent, `${context}.usedPercent`);
  const remaining = percent(obj.remainingPercent, `${context}.remainingPercent`);
  if (remaining !== 100 - used) throw new UsageContractError(`${context}.remainingPercent (${remaining}) does not match 100 - usedPercent (expected ${100 - used})`);
  const win: PublicLimitWindow = {
    id: string(obj.id, `${context}.id`),
    label: string(obj.label, `${context}.label`),
    kind: obj.kind as PublicLimitWindowKind,
    usedPercent: used,
    remainingPercent: remaining,
  };
  if (obj.resetsAtMs !== undefined) win.resetsAtMs = nonNegativeInt(obj.resetsAtMs, `${context}.resetsAtMs`);
  if (obj.windowDurationMs !== undefined) win.windowDurationMs = positiveInt(obj.windowDurationMs, `${context}.windowDurationMs`);
  if (obj.scope !== undefined) win.scope = parseScope(obj.scope, `${context}.scope`);
  return win;
}

function parseExtra(raw: unknown): PublicExtraUsage {
  const obj = object(raw, 'extraUsage');
  keys(obj, ['enabled', 'used', 'limit', 'remaining', 'unit'], 'extraUsage');
  const extra: PublicExtraUsage = {};
  if (obj.enabled !== undefined) {
    if (typeof obj.enabled !== 'boolean') throw new UsageContractError('extraUsage.enabled must be a boolean');
    extra.enabled = obj.enabled;
  }
  if (obj.used !== undefined) extra.used = decimal(obj.used, 'extraUsage.used');
  if (obj.limit !== undefined) extra.limit = decimal(obj.limit, 'extraUsage.limit');
  if (obj.remaining !== undefined) extra.remaining = decimal(obj.remaining, 'extraUsage.remaining');
  if (obj.unit !== undefined) extra.unit = string(obj.unit, 'extraUsage.unit');
  if (extra.used !== undefined && extra.limit !== undefined && extra.remaining !== undefined) checkAmounts(extra.used, extra.limit, extra.remaining);
  return extra;
}

export function parsePublicProviderUsage(value: unknown): PublicProviderUsage {
  const obj = object(value, 'PublicProviderUsage');
  keys(obj, ['providerId', 'displayName', 'status', 'observedAtMs', 'staleAtMs', 'freshness', 'windows', 'extraUsage'], 'PublicProviderUsage');
  if (typeof obj.status !== 'string' || !VALID_PUBLIC_STATUSES.includes(obj.status as PublicUsageStatus)) throw new UsageContractError(`PublicProviderUsage.status must be one of ${VALID_PUBLIC_STATUSES.join(', ')}`);
  if (typeof obj.freshness !== 'string' || !VALID_PUBLIC_FRESHNESSES.includes(obj.freshness as PublicUsageFreshness)) throw new UsageContractError(`PublicProviderUsage.freshness must be one of ${VALID_PUBLIC_FRESHNESSES.join(', ')}`);
  const observedAtMs = nonNegativeInt(obj.observedAtMs, 'PublicProviderUsage.observedAtMs');
  const freshness = obj.freshness as PublicUsageFreshness;
  let staleAtMs: number | undefined;
  if (obj.staleAtMs !== undefined) {
    staleAtMs = nonNegativeInt(obj.staleAtMs, 'PublicProviderUsage.staleAtMs');
    if (staleAtMs < observedAtMs) throw new UsageContractError(`PublicProviderUsage.staleAtMs (${staleAtMs}) cannot be earlier than observedAtMs (${observedAtMs})`);
  }
  if (staleAtMs === undefined && freshness !== 'UNKNOWN') throw new UsageContractError('PublicProviderUsage.freshness must be "UNKNOWN" when staleAtMs is undefined');
  if (staleAtMs !== undefined && freshness === 'UNKNOWN') throw new UsageContractError('PublicProviderUsage.freshness cannot be "UNKNOWN" when staleAtMs is defined');
  if (!Array.isArray(obj.windows)) throw new UsageContractError('PublicProviderUsage.windows must be an array');
  const windows = obj.windows.map(parseWindow);
  if (new Set(windows.map((w) => w.id)).size !== windows.length) throw new UsageContractError('PublicProviderUsage.windows contains duplicate window id');
  const extraUsage = obj.extraUsage === undefined ? undefined : parseExtra(obj.extraUsage);
  const status = obj.status as PublicUsageStatus;
  if (status !== 'AVAILABLE') {
    if (windows.length > 0) throw new UsageContractError(`Non-AVAILABLE status "${status}" must not contain active usage windows (got ${windows.length} windows)`);
    if (extraUsage && (extraUsage.used !== undefined || extraUsage.limit !== undefined || extraUsage.remaining !== undefined)) throw new UsageContractError(`Non-AVAILABLE status "${status}" must not contain active extraUsage data`);
  }
  const result: PublicProviderUsage = {
    providerId: string(obj.providerId, 'PublicProviderUsage.providerId'),
    displayName: string(obj.displayName, 'PublicProviderUsage.displayName'),
    status,
    observedAtMs,
    freshness,
    windows,
  };
  if (staleAtMs !== undefined) result.staleAtMs = staleAtMs;
  if (extraUsage !== undefined) result.extraUsage = extraUsage;
  return result;
}

export function projectProviderUsageForPublic(snapshot: ProviderUsageSnapshot, nowMs: number): PublicProviderUsage {
  const normalized = parseProviderUsageSnapshot(snapshot);
  nonNegativeInt(nowMs, 'nowMs');
  const freshness: PublicUsageFreshness = normalized.staleAtMs === undefined ? 'UNKNOWN' : nowMs < normalized.staleAtMs ? 'FRESH' : 'STALE';
  const windows: PublicLimitWindow[] = normalized.windows.map((win) => {
    if (win.usedPercent === undefined) throw new UsageContractError(`Window "${win.id}" is missing usedPercent`);
    const projected: PublicLimitWindow = {
      id: win.id,
      label: win.label,
      kind: win.kind,
      usedPercent: win.usedPercent,
      remainingPercent: remainingPercent(win.usedPercent),
    };
    if (win.resetsAtMs !== undefined) projected.resetsAtMs = win.resetsAtMs;
    if (win.windowDurationMs !== undefined) projected.windowDurationMs = win.windowDurationMs;
    if (win.scope !== undefined) {
      projected.scope = { kind: win.scope.kind };
      if (win.scope.id !== undefined) projected.scope.id = win.scope.id;
      if (win.scope.label !== undefined) projected.scope.label = win.scope.label;
    }
    return projected;
  });
  let extraUsage: PublicExtraUsage | undefined;
  if (normalized.extraUsage !== undefined) {
    extraUsage = {};
    if (normalized.extraUsage.enabled !== undefined) extraUsage.enabled = normalized.extraUsage.enabled;
    if (normalized.extraUsage.used !== undefined) extraUsage.used = normalized.extraUsage.used;
    if (normalized.extraUsage.limit !== undefined) extraUsage.limit = normalized.extraUsage.limit;
    if (normalized.extraUsage.remaining !== undefined) extraUsage.remaining = normalized.extraUsage.remaining;
    if (normalized.extraUsage.unit !== undefined) extraUsage.unit = normalized.extraUsage.unit;
  }
  const dto: PublicProviderUsage = {
    providerId: normalized.providerId,
    displayName: normalized.displayName,
    status: normalized.status,
    observedAtMs: normalized.observedAtMs,
    freshness,
    windows,
  };
  if (normalized.staleAtMs !== undefined) dto.staleAtMs = normalized.staleAtMs;
  if (extraUsage !== undefined) dto.extraUsage = extraUsage;
  return parsePublicProviderUsage(dto);
}

function sample(clock: PublicProjectionClock): number {
  return nonNegativeInt(clock(), 'Projection clock sample');
}

export class UsageLimitsPublicFacade {
  readonly #service: UsageLimitsPublicServiceLike;
  readonly #clock: PublicProjectionClock;

  constructor(service: UsageLimitsPublicServiceLike, clock: PublicProjectionClock) {
    if (!service || typeof service !== 'object' || Array.isArray(service)) throw new UsageContractError('service must be a non-null plain object');
    if (typeof service.getRegisteredProviderIds !== 'function') throw new UsageContractError('service.getRegisteredProviderIds must be a function');
    if (typeof service.getCachedSnapshot !== 'function') throw new UsageContractError('service.getCachedSnapshot must be a function');
    if (typeof service.refreshProvider !== 'function') throw new UsageContractError('service.refreshProvider must be a function');
    if (typeof clock !== 'function') throw new UsageContractError('clock must be a callable function');
    this.#service = service;
    this.#clock = clock;
  }

  getCachedProvider(providerId: string): PublicProviderUsage | undefined {
    const cached = this.#service.getCachedSnapshot(string(providerId, 'providerId'));
    return cached === undefined ? undefined : projectProviderUsageForPublic(cached, sample(this.#clock));
  }

  getCachedProviders(): PublicProviderUsage[] {
    const ids = this.#service.getRegisteredProviderIds();
    if (!Array.isArray(ids)) throw new UsageContractError('service.getRegisteredProviderIds() must return an array');
    const cached: ProviderUsageSnapshot[] = [];
    for (const id of ids) {
      const snapshot = this.#service.getCachedSnapshot(string(id, 'Registered providerId'));
      if (snapshot !== undefined) cached.push(snapshot);
    }
    if (cached.length === 0) return [];
    const now = sample(this.#clock);
    return cached.map((snapshot) => projectProviderUsageForPublic(snapshot, now));
  }

  async refreshProvider(providerId: string, options?: PublicRefreshProviderOptions): Promise<PublicProviderUsage> {
    const cleanId = string(providerId, 'providerId');
    let bounded: { force?: boolean } | undefined;
    if (options !== undefined) {
      const obj = object(options, 'options');
      keys(obj, ['force'], 'options');
      if (obj.force !== undefined && typeof obj.force !== 'boolean') throw new UsageContractError('options.force must be a boolean');
      bounded = obj.force === undefined ? {} : { force: obj.force as boolean };
    }
    const snapshot = await this.#service.refreshProvider(cleanId, bounded);
    return projectProviderUsageForPublic(snapshot, sample(this.#clock));
  }
}
