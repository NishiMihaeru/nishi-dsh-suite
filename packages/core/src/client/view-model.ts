import type {
  PublicExtraUsage,
  PublicLimitWindow,
  PublicProviderUsage,
  PublicUsageStatus,
} from '../usage/index.js'
import type { en } from './locales.js'

export type UsageLimitsLocaleKey = keyof typeof en

export function computeLowestRemainingPercent(usages: Array<PublicProviderUsage | undefined>): number | undefined {
  let minVal: number | undefined
  for (const usage of usages) {
    if (!usage || usage.status !== 'AVAILABLE') continue
    for (const win of usage.windows) {
      if (win.scope && win.scope.kind !== 'PROVIDER') continue
      if (typeof win.remainingPercent === 'number' && !Number.isNaN(win.remainingPercent)) {
        if (minVal === undefined || win.remainingPercent < minVal) minVal = win.remainingPercent
      }
    }
  }
  return minVal
}

export function formatPercent(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? '—' : `${Math.round(value)}%`
}

export function sortWindows(windows: PublicLimitWindow[]): PublicLimitWindow[] {
  const scopeRank = (win: PublicLimitWindow): number => !win.scope || win.scope.kind === 'PROVIDER' ? 0 : win.scope.kind === 'MODEL' ? 1 : win.scope.kind === 'BUCKET' ? 2 : 3
  const kindRank = (win: PublicLimitWindow): number => win.kind === 'SHORT' ? 0 : win.kind === 'WEEKLY' ? 1 : win.kind === 'OTHER' ? 2 : 3
  return [...windows].sort((a, b) => scopeRank(a) - scopeRank(b) || kindRank(a) - kindRank(b) || a.label.localeCompare(b.label))
}

export function formatAbsoluteDateTime(ms: number | undefined, locale = 'en', options?: Intl.DateTimeFormatOptions): string | undefined {
  if (ms === undefined || Number.isNaN(ms)) return undefined
  try {
    return new Intl.DateTimeFormat(locale, options || { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

export function formatResetTime(resetsAtMs: number | undefined, nowMs: number, locale = 'en', t?: (key: UsageLimitsLocaleKey) => string): string | undefined {
  if (resetsAtMs === undefined || Number.isNaN(resetsAtMs)) return undefined
  const formattedAbs = formatAbsoluteDateTime(resetsAtMs, locale)
  if (!formattedAbs) return undefined
  const passedPrefix = t ? t('resetTimePassed') : 'Reset time passed'
  const resetsPrefix = t ? t('resetsAt') : 'Resets'
  return resetsAtMs <= nowMs ? `${passedPrefix} · ${formattedAbs}` : `${resetsPrefix}: ${formattedAbs}`
}

export function formatObservedTime(observedAtMs: number | undefined, locale = 'en', t?: (key: UsageLimitsLocaleKey) => string): string | undefined {
  if (observedAtMs === undefined || Number.isNaN(observedAtMs)) return undefined
  const formattedAbs = formatAbsoluteDateTime(observedAtMs, locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  if (!formattedAbs) return undefined
  return `${t ? t('lastChecked') : 'Last checked'}: ${formattedAbs}`
}

export function getStatusBadgeLabel(status: PublicUsageStatus, t: (key: UsageLimitsLocaleKey) => string): string {
  switch (status) {
    case 'AVAILABLE': return t('badgeAvailable')
    case 'UNSUPPORTED': return t('badgeUnsupported')
    case 'LOGIN_REQUIRED': return t('badgeLoginRequired')
    case 'UNAVAILABLE': return t('badgeUnavailable')
    case 'ERROR': return t('badgeError')
    default: return t('badgeError')
  }
}

export function formatExtraUsage(extra: PublicExtraUsage | undefined): { used?: string; limit?: string; remaining?: string; enabled?: boolean } {
  if (!extra) return {}
  const result: { used?: string; limit?: string; remaining?: string; enabled?: boolean } = {}
  if (extra.used) result.used = extra.unit ? `${extra.used} ${extra.unit}` : extra.used
  if (extra.limit) result.limit = extra.unit ? `${extra.limit} ${extra.unit}` : extra.limit
  if (extra.remaining) result.remaining = extra.unit ? `${extra.remaining} ${extra.unit}` : extra.remaining
  if (extra.enabled !== undefined) result.enabled = extra.enabled
  return result
}

export interface ProviderRingsData {
  weeklyPercent?: number
  shortPercent?: number
  weeklyWindow?: PublicLimitWindow
  shortWindow?: PublicLimitWindow
}

export function extractProviderRings(usage: PublicProviderUsage | undefined): ProviderRingsData {
  if (!usage || usage.status !== 'AVAILABLE') return {}
  let weeklyWindow: PublicLimitWindow | undefined
  let shortWindow: PublicLimitWindow | undefined
  for (const win of usage.windows) {
    if (win.scope && win.scope.kind !== 'PROVIDER') continue
    if (win.kind === 'WEEKLY' && !weeklyWindow) weeklyWindow = win
    else if (win.kind === 'SHORT' && !shortWindow) shortWindow = win
  }
  return { weeklyPercent: weeklyWindow?.usedPercent, shortPercent: shortWindow?.usedPercent, weeklyWindow, shortWindow }
}

export function extractBucketWindows(usage: PublicProviderUsage | undefined): PublicLimitWindow[] {
  if (!usage || usage.status !== 'AVAILABLE') return []
  return usage.windows.filter((win) => win.scope?.kind === 'BUCKET')
}

export function formatWindowTooltip(win: PublicLimitWindow, nowMs?: number, locale = 'en', t?: (key: UsageLimitsLocaleKey) => string): string {
  const usedLabel = t ? t('used') : 'Used'
  const remainingLabel = t ? t('remaining') : 'Remaining'
  let result = `${win.label}: ${formatPercent(win.usedPercent)} ${usedLabel.toLowerCase()}, ${formatPercent(win.remainingPercent)} ${remainingLabel.toLowerCase()}`
  const resetText = nowMs !== undefined ? formatResetTime(win.resetsAtMs, nowMs, locale, t) : undefined
  if (resetText) result += ` (${resetText})`
  return result
}
