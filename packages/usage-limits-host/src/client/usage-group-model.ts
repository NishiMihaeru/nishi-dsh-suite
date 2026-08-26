import type {
  PublicExtraUsage,
  PublicLimitWindow,
  PublicProviderUsage,
  PublicUsageFreshness,
  PublicUsageStatus,
} from 'nishi-dsh-usage-limits'

export type UsageGroupKind = 'PROVIDER' | 'POOL'
export type PresentationUsageStatus = PublicUsageStatus | 'LOADING'
export interface UsageGroup {
  id: string
  providerId: string
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
  providerId: string
  defaultDisplayName: string
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
function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bucket'
}
function stripCadenceFromLabel(value: string): string {
  return value.replace(/\b(?:5\s*-?\s*h(?:our)?s?|five\s*-?\s*hours?|weekly|week|7\s*-?\s*days?|session|short|limit|quota|remaining)\b/gi, ' ')
    .replace(/[·|:/_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
interface BucketIdentity { id: string; displayName: string; rank: number }
function bucketIdentity(win: PublicLimitWindow): BucketIdentity {
  const raw = `${win.scope?.label ?? ''} ${win.scope?.id ?? ''} ${win.label}`.toLowerCase()
  if (raw.includes('gemini')) return { id: 'gemini', displayName: 'Gemini', rank: 0 }
  if (raw.includes('claude') || raw.includes('gpt') || raw.includes('external')) return { id: 'external', displayName: 'Claude/GPT', rank: 1 }
  const scopeLabel = win.scope?.label?.trim()
  const inferredLabel = scopeLabel || stripCadenceFromLabel(win.label) || win.scope?.id || win.label
  return { id: slug(inferredLabel), displayName: inferredLabel, rank: 10 }
}
function providerWindowsForPresentation(usage: PublicProviderUsage): PublicLimitWindow[] {
  const own = usage.windows.filter(isProviderWindow)
  if (usage.providerId === 'antigravity') return own
  return [...own, ...usage.windows.filter(isBucketWindow).filter((bucket) => !own.some((win) => win.kind === bucket.kind))]
}

export function buildUsageGroups(usage: PublicProviderUsage): UsageGroup[] {
  const common = {
    providerId: usage.providerId,
    status: usage.status as PresentationUsageStatus,
    freshness: usage.freshness,
    observedAtMs: usage.observedAtMs,
  }
  if (usage.status !== 'AVAILABLE') {
    return [{ id: usage.providerId, ...common, displayName: usage.displayName, kind: 'PROVIDER', windows: [], extraUsage: usage.extraUsage }]
  }
  const groups: UsageGroup[] = []
  const ownWindows = providerWindowsForPresentation(usage)
  if (ownWindows.length > 0) {
    groups.push({ id: usage.providerId, ...common, displayName: usage.displayName, kind: 'PROVIDER', windows: sortUsageGroupWindows(ownWindows), extraUsage: usage.extraUsage })
  }
  if (usage.providerId === 'antigravity') {
    const poolMap = new Map<string, { identity: BucketIdentity; windows: PublicLimitWindow[] }>()
    for (const win of usage.windows.filter(isBucketWindow)) {
      const identity = bucketIdentity(win)
      const existing = poolMap.get(identity.id)
      if (existing) existing.windows.push(win)
      else poolMap.set(identity.id, { identity, windows: [win] })
    }
    const pools = [...poolMap.values()].sort((a, b) => a.identity.rank - b.identity.rank || a.identity.displayName.localeCompare(b.identity.displayName))
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
    return buildUsageGroups(input.usage).map((group) => ({ ...group, refreshing: input.loadStatus === 'loading', loadError: input.loadStatus === 'error' }))
  }
  const status: PresentationUsageStatus = input.loadStatus === 'loading' ? 'LOADING' : input.loadStatus === 'error' ? 'ERROR' : 'UNAVAILABLE'
  return [{ id: input.providerId, providerId: input.providerId, displayName: input.defaultDisplayName, kind: 'PROVIDER', status, refreshing: input.loadStatus === 'loading', loadError: input.loadStatus === 'error', windows: [] }]
}
