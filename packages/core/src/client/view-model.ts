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

export interface UsageSidebarSettings {
  readonly order?: readonly string[]
  readonly hidden?: readonly string[]
}

export interface OrderedRosterItem<T> {
  readonly entry: T
  readonly visible: boolean
}

export function resolveOrderedRoster<T extends { providerId: string; id?: string }>(
  roster: readonly T[],
  settings?: UsageSidebarSettings | null,
): OrderedRosterItem<T>[] {
  const hiddenSet = new Set(settings?.hidden ?? [])
  const getItemId = (item: T): string => (typeof item.id === 'string' && item.id.length > 0 ? item.id : item.providerId)
  const availableMap = new Map(roster.map((item) => [getItemId(item), item] as const))
  const result: OrderedRosterItem<T>[] = []
  const seen = new Set<string>()

  if (settings?.order) {
    for (const id of settings.order) {
      const entry = availableMap.get(id)
      if (entry !== undefined && !seen.has(getItemId(entry))) {
        seen.add(getItemId(entry))
        result.push({
          entry,
          visible: !hiddenSet.has(id) && !hiddenSet.has(entry.providerId),
        })
      } else {
        const matchingEntries = roster.filter((item) => item.providerId === id && !seen.has(getItemId(item)))
        for (const matching of matchingEntries) {
          const entryId = getItemId(matching)
          seen.add(entryId)
          result.push({
            entry: matching,
            visible: !hiddenSet.has(entryId) && !hiddenSet.has(matching.providerId),
          })
        }
      }
    }
  }

  for (const item of roster) {
    const id = getItemId(item)
    if (!seen.has(id)) {
      seen.add(id)
      result.push({
        entry: item,
        visible: !hiddenSet.has(id) && !hiddenSet.has(item.providerId),
      })
    }
  }

  return result
}

export function resolveSidebarProviders<T extends { providerId: string; id?: string }>(
  roster: readonly T[],
  settings?: UsageSidebarSettings | null,
): T[] {
  return resolveOrderedRoster(roster, settings)
    .filter((item) => item.visible)
    .map((item) => item.entry)
}

export function updateProviderVisibility(
  settings: UsageSidebarSettings | undefined,
  targetId: string,
  visible: boolean,
): UsageSidebarSettings {
  const currentHidden = new Set(settings?.hidden ?? [])
  if (visible) {
    currentHidden.delete(targetId)
  } else {
    currentHidden.add(targetId)
  }
  const hidden = [...currentHidden]
  return {
    ...settings,
    hidden: hidden.length > 0 ? hidden : undefined,
  }
}

/**
 * Move one provider or pool one slot up or down, without forgetting the items
 * that are not registered right now.
 *
 * The move itself happens among the items the user can actually see, so
 * a step never lands on an invisible neighbour and appears to do nothing.
 * What is written back is wider than that: an id in the saved order that no
 * provider/pool currently claims keeps its exact slot, and the reordered visible
 * items fill the slots around it.
 */
export function moveProviderInOrder<T extends { providerId: string; id?: string }>(
  roster: readonly T[],
  settings: UsageSidebarSettings | undefined,
  targetId: string,
  direction: 'up' | 'down',
): UsageSidebarSettings {
  const getItemId = (item: T): string => (typeof item.id === 'string' && item.id.length > 0 ? item.id : item.providerId)
  const present = resolveOrderedRoster(roster, settings).map((i) => getItemId(i.entry))
  const index = present.indexOf(targetId)
  if (index === -1) return settings ?? {}
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= present.length) return settings ?? {}
  const nextPresent = [...present]
  const [removed] = nextPresent.splice(index, 1)
  nextPresent.splice(targetIndex, 0, removed!)

  // Every id this setting has ever placed, in its placed order, followed by
  // whatever the roster offers that it has not placed yet. Deduplicated
  // because a hand-edited or migrated setting may repeat an id, and a repeat
  // would consume two slots from a list that has one entry for it.
  const saved = [...new Set(settings?.order ?? [])]
  const expandedSaved = saved.flatMap((id) => {
    if (present.includes(id)) return [id]
    const matching = present.filter((p) => p.startsWith(`${id}:`))
    return matching.length > 0 ? matching : [id]
  })
  const union = [...new Set([...expandedSaved, ...present.filter((id) => !expandedSaved.includes(id))])]

  const presentSet = new Set(present)
  let cursor = 0
  const order = union.map((id) => (presentSet.has(id) ? nextPresent[cursor++]! : id))
  return {
    ...settings,
    order,
  }
}
