import type {
  PublicExtraUsage,
  PublicLimitWindow,
  PublicProviderUsage,
  PublicUsageFreshness,
  PublicUsageStatus,
} from '../usage/index.js'

import type { ProviderPresentation } from './rpc-client.js'

export type UsageGroupKind = 'PROVIDER' | 'POOL'
export type PresentationUsageStatus = PublicUsageStatus | 'LOADING'
export interface UsageGroup {
  id: string
  providerId: string
  /** Carried on the group so no component has to look identity up by id. */
  presentation: ProviderPresentation
  parentDisplayName?: string
  displayName: string
  kind: UsageGroupKind
  status: PresentationUsageStatus
  freshness?: PublicUsageFreshness
  observedAtMs?: number
  refreshing?: boolean
  loadError?: boolean
  windows: PublicLimitWindow[]
  extraUsage?: PublicExtraUsage
}
export interface UsageProviderPresentationInput {
  presentation: ProviderPresentation
  loadStatus: 'idle' | 'loading' | 'ready' | 'error'
  usage?: PublicProviderUsage
}

function isProviderWindow(win: PublicLimitWindow): boolean { return !win.scope || win.scope.kind === 'PROVIDER' }
function isBucketWindow(win: PublicLimitWindow): boolean { return win.scope?.kind === 'BUCKET' }
export function usageWindowPriority(win: PublicLimitWindow): number {
  if (win.kind === 'SHORT') return 10
  if (win.kind === 'WEEKLY') return 20
  return 100
}
export function usageWindowDisplayLabel(win: PublicLimitWindow): string {
  if (win.kind === 'SHORT') return '5h'
  if (win.kind === 'WEEKLY') return 'Weekly'
  return win.label
}
export function sortUsageGroupWindows(windows: PublicLimitWindow[]): PublicLimitWindow[] {
  return [...windows].sort((a, b) => usageWindowPriority(a) - usageWindowPriority(b) || a.label.localeCompare(b.label))
}
export function selectUsageGroupDisplayWindows(windows: PublicLimitWindow[]): PublicLimitWindow[] {
  const sorted = sortUsageGroupWindows(windows)
  const selected: PublicLimitWindow[] = []
  const short = sorted.find((win) => win.kind === 'SHORT')
  const weekly = sorted.find((win) => win.kind === 'WEEKLY')
  if (short) selected.push(short)
  if (weekly) selected.push(weekly)
  for (const win of sorted) {
    if (selected.length >= 2) break
    if (!selected.includes(win)) selected.push(win)
  }
  return selected
}
interface BucketIdentity { id: string; displayName: string }

/**
 * A pool's identity comes from the scope the provider's normalizer emitted.
 * The browser used to derive it by matching vendor names against window
 * labels, which made every new vendor pool a browser edit and mislabelled
 * anything unrecognised.
 */
function bucketIdentity(win: PublicLimitWindow): BucketIdentity {
  const id = win.scope?.id?.trim()
  const label = win.scope?.label?.trim()
  return {
    id: id && id.length > 0 ? id : label ?? win.label,
    displayName: label && label.length > 0 ? label : (id ?? win.label),
  }
}

function providerWindowsForPresentation(
  usage: PublicProviderUsage,
  presentation: ProviderPresentation,
): PublicLimitWindow[] {
  const own = usage.windows.filter(isProviderWindow)
  // A provider whose account is several pools shows them as their own groups;
  // otherwise a bucket window with no provider-level counterpart is folded in
  // rather than hidden.
  if (presentation.bucketsAsPools === true) return own
  return [...own, ...usage.windows.filter(isBucketWindow).filter((bucket) => !own.some((win) => win.kind === bucket.kind))]
}

export function buildUsageGroups(usage: PublicProviderUsage, presentation: ProviderPresentation): UsageGroup[] {
  const common = {
    providerId: usage.providerId,
    presentation,
    status: usage.status as PresentationUsageStatus,
    freshness: usage.freshness,
    observedAtMs: usage.observedAtMs,
  }
  if (usage.status !== 'AVAILABLE') {
    return [{ id: usage.providerId, ...common, displayName: usage.displayName, kind: 'PROVIDER', windows: [], extraUsage: usage.extraUsage }]
  }
  const groups: UsageGroup[] = []
  const ownWindows = providerWindowsForPresentation(usage, presentation)
  if (ownWindows.length > 0) {
    groups.push({ id: usage.providerId, ...common, displayName: usage.displayName, kind: 'PROVIDER', windows: sortUsageGroupWindows(ownWindows), extraUsage: usage.extraUsage })
  }
  if (presentation.bucketsAsPools === true) {
    const poolMap = new Map<string, { identity: BucketIdentity; windows: PublicLimitWindow[] }>()
    for (const win of usage.windows.filter(isBucketWindow)) {
      const identity = bucketIdentity(win)
      const existing = poolMap.get(identity.id)
      if (existing) existing.windows.push(win)
      else poolMap.set(identity.id, { identity, windows: [win] })
    }
    const pools = [...poolMap.values()].sort((a, b) => a.identity.displayName.localeCompare(b.identity.displayName))
    for (const pool of pools) {
      groups.push({
        id: `${usage.providerId}:pool:${pool.identity.id}`,
        ...common,
        parentDisplayName: usage.displayName,
        displayName: pool.identity.displayName,
        kind: 'POOL',
        windows: sortUsageGroupWindows(pool.windows),
      })
    }
  }
  if (groups.length === 0) {
    groups.push({ id: usage.providerId, ...common, displayName: usage.displayName, kind: 'PROVIDER', windows: [], extraUsage: usage.extraUsage })
  }
  return groups
}

export function buildUsageGroupsForProvider(input: UsageProviderPresentationInput): UsageGroup[] {
  if (input.usage) {
    return buildUsageGroups(input.usage, input.presentation).map((group) => ({ ...group, refreshing: input.loadStatus === 'loading', loadError: input.loadStatus === 'error' }))
  }
  const status: PresentationUsageStatus = input.loadStatus === 'loading' ? 'LOADING' : input.loadStatus === 'error' ? 'ERROR' : 'UNAVAILABLE'
  return [{
    id: input.presentation.id,
    providerId: input.presentation.id,
    presentation: input.presentation,
    displayName: input.presentation.displayName,
    kind: 'PROVIDER',
    status,
    refreshing: input.loadStatus === 'loading',
    loadError: input.loadStatus === 'error',
    windows: [],
  }]
}
