/** Claude usage collector and normalizer. */
import {
  UsageContractError,
  parseProviderUsageSnapshot,
  type ProviderUsageSnapshot,
  type LimitWindow,
  type ExtraUsage,
  type UsageSourceMetadata,
} from '../contract.js';
import { VendorUsageCollector, type VendorUsageSource, type VendorUsageCollectorSpec } from './vendor-collector.js';

export const CLAUDE_PROVIDER_ID = 'claude';
export const CLAUDE_DISPLAY_NAME = 'Claude';
export const CLAUDE_COLLECTOR_ID = 'claude-usage';
export const CLAUDE_COLLECTOR_VERSION = '0.1.0';
export const CLAUDE_CAPABILITY_CLASS = 'SUPPORTED_OFFICIAL';
export const CLAUDE_SOURCE_KIND = 'OFFICIAL_LOCAL_PROTOCOL';

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;
const ISO_WITH_EXPLICIT_TZ_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):?(\d{2}))$/i;

export type ClaudeUsageSourceErrorCode = 'LOGIN_REQUIRED' | 'UNAVAILABLE' | 'ERROR';
export class ClaudeUsageSourceError extends Error {
  readonly code: ClaudeUsageSourceErrorCode;
  constructor(message: string, code: ClaudeUsageSourceErrorCode = 'ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClaudeUsageSourceError';
    this.code = code;
  }
}
export type ClaudeUsageSource = VendorUsageSource;

function assertPlainObject(val: unknown, context: string): Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) throw new UsageContractError(`${context} must be a non-null plain object`);
  return val as Record<string, unknown>;
}
function assertOptionalPlainObject(val: unknown, context: string): Record<string, unknown> | undefined {
  if (val === undefined || val === null) return undefined;
  return assertPlainObject(val, context);
}
function assertOptionalArray(val: unknown, context: string): unknown[] | undefined {
  if (val === undefined || val === null) return undefined;
  if (!Array.isArray(val)) throw new UsageContractError(`${context} must be an array (got ${typeof val})`);
  return val;
}
function assertOptionalBoolean(val: unknown, context: string): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'boolean') throw new UsageContractError(`${context} must be a boolean (got ${typeof val})`);
  return val;
}
function assertOptionalNonNegativeNumber(val: unknown, context: string): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) throw new UsageContractError(`${context} must be a non-negative finite number (got ${val})`);
  return val;
}
function assertOptionalNonEmptyString(val: unknown, context: string): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string' || val.trim().length === 0) throw new UsageContractError(`${context} must be a non-empty string`);
  return val.trim();
}
function isLeapYear(year: number): boolean { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0; }
function daysInMonth(year: number, month: number): number {
  if ([1,3,5,7,8,10,12].includes(month)) return 31;
  if ([4,6,9,11].includes(month)) return 30;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return 0;
}
function parseIsoTimestamp(isoString: unknown, context: string): number {
  if (typeof isoString !== 'string') throw new UsageContractError(`${context} must be an absolute ISO 8601 string with explicit timezone (got "${String(isoString)}")`);
  const str = isoString.trim();
  const match = ISO_WITH_EXPLICIT_TZ_REGEX.exec(str);
  if (!match) throw new UsageContractError(`${context} must be an absolute ISO 8601 string with explicit timezone (got "${str}")`);
  const year = parseInt(match[1], 10), month = parseInt(match[2], 10), day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10), minute = parseInt(match[5], 10), second = parseInt(match[6], 10);
  if (month < 1 || month > 12) throw new UsageContractError(`${context} month must be between 01 and 12 (got "${match[2]}")`);
  const maxDays = daysInMonth(year, month);
  if (day < 1 || day > maxDays) throw new UsageContractError(`${context} day must be between 01 and ${maxDays} for year ${year}, month ${month} (got "${match[3]}")`);
  if (hour < 0 || hour > 23) throw new UsageContractError(`${context} hour must be between 00 and 23 (got "${match[4]}")`);
  if (minute < 0 || minute > 59) throw new UsageContractError(`${context} minute must be between 00 and 59 (got "${match[5]}")`);
  if (second < 0 || second > 59) throw new UsageContractError(`${context} second must be between 00 and 59 (got "${match[6]}")`);
  if (match[9]) {
    const tzHour = parseInt(match[10], 10), tzMinute = parseInt(match[11], 10);
    if (tzHour < 0 || tzHour > 23 || tzMinute < 0 || tzMinute > 59) throw new UsageContractError(`${context} invalid timezone offset "${match[8]}"`);
  }
  const ms = Date.parse(str);
  if (!Number.isFinite(ms) || Number.isNaN(ms) || ms < 0) throw new UsageContractError(`${context} produced invalid timestamp "${str}"`);
  return ms;
}
function parsePercent(val: unknown, context: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100) throw new UsageContractError(`${context} must be a finite number between 0 and 100 inclusive (got ${val})`);
  return val;
}
function defaultSourceMetadata(): UsageSourceMetadata {
  return { kind: CLAUDE_SOURCE_KIND, collectorId: CLAUDE_COLLECTOR_ID, collectorVersion: CLAUDE_COLLECTOR_VERSION, capabilityClass: CLAUDE_CAPABILITY_CLASS };
}

export function normalizeClaudeUsage(payload: unknown, observedAtMs: number): ProviderUsageSnapshot {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`);
  const raw = assertPlainObject(payload, 'Claude usage payload');
  if (typeof raw.rate_limits_available !== 'boolean') throw new UsageContractError('Claude usage payload missing boolean "rate_limits_available"');
  if (!raw.rate_limits_available) {
    if (raw.rate_limits !== undefined && raw.rate_limits !== null) assertPlainObject(raw.rate_limits, 'rate_limits');
    return parseProviderUsageSnapshot({ providerId: CLAUDE_PROVIDER_ID, displayName: CLAUDE_DISPLAY_NAME, status: 'UNSUPPORTED', observedAtMs, windows: [], source: defaultSourceMetadata() });
  }
  const limits = assertOptionalPlainObject(raw.rate_limits, 'rate_limits');
  const windows: LimitWindow[] = [];
  let extraUsage: ExtraUsage | undefined;
  const addWindow = (key: string, id: string, label: string, model?: string) => {
    const source = limits ? assertOptionalPlainObject(limits[key], `rate_limits.${key}`) : undefined;
    if (!source) return;
    const win: LimitWindow = {
      id,
      label,
      kind: key === 'five_hour' ? 'SHORT' : 'WEEKLY',
      windowDurationMs: key === 'five_hour' ? FIVE_HOUR_MS : SEVEN_DAY_MS,
      scope: model ? { kind: 'MODEL', id: model, label } : { kind: 'PROVIDER' },
    };
    if (source.utilization !== null && source.utilization !== undefined) win.usedPercent = parsePercent(source.utilization, `${key}.utilization`);
    if (source.resets_at !== null && source.resets_at !== undefined) win.resetsAtMs = parseIsoTimestamp(source.resets_at, `${key}.resets_at`);
    windows.push(win);
  };
  if (limits) {
    addWindow('five_hour', 'five-hour', '5-hour');
    addWindow('seven_day', 'seven-day', 'Weekly');
    addWindow('seven_day_opus', 'model:seven_day_opus', 'Opus', 'seven_day_opus');
    addWindow('seven_day_sonnet', 'model:seven_day_sonnet', 'Sonnet', 'seven_day_sonnet');
    const oauth = assertOptionalPlainObject(limits.seven_day_oauth_apps, 'rate_limits.seven_day_oauth_apps');
    if (oauth) {
      if (oauth.utilization !== null && oauth.utilization !== undefined) parsePercent(oauth.utilization, 'seven_day_oauth_apps.utilization');
      if (oauth.resets_at !== null && oauth.resets_at !== undefined) parseIsoTimestamp(oauth.resets_at, 'seven_day_oauth_apps.resets_at');
    }
    const msArr = assertOptionalArray(limits.model_scoped, 'rate_limits.model_scoped');
    if (msArr) {
      for (let i = 0; i < msArr.length; i++) {
        const item = assertPlainObject(msArr[i], `model_scoped[${i}]`);
        assertOptionalNonEmptyString(item.display_name, `model_scoped[${i}].display_name`);
        if (item.display_name === undefined || item.display_name === null) throw new UsageContractError(`model_scoped[${i}].display_name must be a non-empty string`);
        if (item.utilization !== null && item.utilization !== undefined) assertOptionalNonNegativeNumber(item.utilization, `model_scoped[${i}].utilization`);
        if (item.resets_at !== null && item.resets_at !== undefined) parseIsoTimestamp(item.resets_at, `model_scoped[${i}].resets_at`);
      }
    }
    const eu = assertOptionalPlainObject(limits.extra_usage, 'rate_limits.extra_usage');
    if (eu) {
      const extra: ExtraUsage = {};
      const enabled = assertOptionalBoolean(eu.is_enabled, 'extra_usage.is_enabled');
      if (enabled !== undefined) extra.enabled = enabled;
      const used = assertOptionalNonNegativeNumber(eu.used_credits, 'extra_usage.used_credits');
      if (used !== undefined) extra.used = String(used);
      const limit = assertOptionalNonNegativeNumber(eu.monthly_limit, 'extra_usage.monthly_limit');
      if (limit !== undefined) extra.limit = String(limit);
      const unit = assertOptionalNonEmptyString(eu.currency, 'extra_usage.currency');
      if (unit !== undefined) extra.unit = unit;
      if (extra.enabled !== undefined || extra.used !== undefined || extra.limit !== undefined || extra.unit !== undefined) extraUsage = extra;
    }
  }
  const snapshot: ProviderUsageSnapshot = { providerId: CLAUDE_PROVIDER_ID, displayName: CLAUDE_DISPLAY_NAME, status: 'AVAILABLE', observedAtMs, windows, source: defaultSourceMetadata() };
  if (extraUsage !== undefined) snapshot.extraUsage = extraUsage;
  return parseProviderUsageSnapshot(snapshot);
}

const CLAUDE_COLLECTOR_SPEC: VendorUsageCollectorSpec<unknown> = {
  providerId: CLAUDE_PROVIDER_ID,
  displayName: CLAUDE_DISPLAY_NAME,
  sourceMetadata: defaultSourceMetadata,
  sourceErrorCode: (err) => (err instanceof ClaudeUsageSourceError ? err.code : undefined),
  normalize: normalizeClaudeUsage,
};

export class ClaudeUsageCollector extends VendorUsageCollector<unknown> {
  constructor(source: ClaudeUsageSource) {
    super(source, CLAUDE_COLLECTOR_SPEC);
  }
}
