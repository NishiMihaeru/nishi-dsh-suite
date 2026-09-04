/**
 * Grok usage capability collector and normalizer.
 *
 * Quota is one weekly credit allowance published by the vendor's ACP
 * `_x.ai/billing` method. A reading with no finite percentage inside an open
 * period is unavailability, not a meter of zero.
 *
 * @module nishi-dsh-grok/usage
 */
import {
  UsageContractError,
  parseProviderUsageSnapshot,
  type ProviderUsageSnapshot,
  type ProviderUsageStatus,
  type UsageSourceMetadata,
  type LimitWindow,
  type LimitWindowKind,
} from 'nishi-dsh-core/usage'
import { VendorUsageCollector, type VendorUsageSource, type VendorUsageCollectorSpec } from 'nishi-dsh-core/usage'

export const GROK_PROVIDER_ID = 'grok'
export const GROK_DISPLAY_NAME = 'Grok Build CLI'
export const GROK_COLLECTOR_ID = 'grok-usage-billing'
export const GROK_COLLECTOR_VERSION = '0.1.0'
export const GROK_CAPABILITY_CLASS = 'NUMERIC_USAGE_AVAILABLE'
export const GROK_SOURCE_KIND = 'OFFICIAL_LOCAL_PROTOCOL'

export type GrokObservationKind = 'NUMERIC_USAGE_AVAILABLE' | 'UNAVAILABLE'

/** One credit window the billing method published, already checked for an open period. */
export interface GrokBillingWindowObservation {
  readonly id: string
  readonly windowKind: 'SHORT' | 'WEEKLY' | 'OTHER'
  readonly label: string
  readonly usedPercent: number
  readonly resetsAtMs?: number
  readonly windowDurationMs?: number
  readonly tierLabel?: string
}

export interface GrokNumericUsageObservation {
  readonly kind: 'NUMERIC_USAGE_AVAILABLE'
  readonly windows: readonly GrokBillingWindowObservation[]
}

export interface GrokCapabilityObservation {
  readonly kind: Exclude<GrokObservationKind, 'NUMERIC_USAGE_AVAILABLE'>
}

export type GrokObservation = GrokNumericUsageObservation | GrokCapabilityObservation

export type GrokUsageSourceErrorCode = 'UNAVAILABLE' | 'ERROR'
export class GrokUsageSourceError extends Error {
  readonly code: GrokUsageSourceErrorCode
  constructor(message: string, code: GrokUsageSourceErrorCode = 'ERROR', options?: ErrorOptions) {
    super(message, options)
    this.name = 'GrokUsageSourceError'
    this.code = code
  }
}

export type GrokUsageCapabilitySource = VendorUsageSource<GrokObservation>

function assertPlainObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageContractError(`${context} must be a non-null plain object`)
  }
  return value as Record<string, unknown>
}

function assertNoUnknownKeys(obj: Record<string, unknown>, allowedKeys: readonly string[], context: string): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new UsageContractError(`${context} contains unrecognized key "${key}"`)
  }
}

function defaultSourceMetadata(): UsageSourceMetadata {
  return {
    kind: GROK_SOURCE_KIND,
    collectorId: GROK_COLLECTOR_ID,
    collectorVersion: GROK_COLLECTOR_VERSION,
    capabilityClass: 'UNSUPPORTED',
  }
}

function numericSourceMetadata(): UsageSourceMetadata {
  return {
    kind: GROK_SOURCE_KIND,
    collectorId: GROK_COLLECTOR_ID,
    collectorVersion: GROK_COLLECTOR_VERSION,
    capabilityClass: GROK_CAPABILITY_CLASS,
  }
}

/** Project one billing observation onto the provider-agnostic snapshot. */
export function normalizeGrokUsage(observation: unknown, observedAtMs: number): ProviderUsageSnapshot {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) {
    throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`)
  }

  const obj = assertPlainObject(observation, 'GrokObservation')
  const kind = obj.kind
  if (typeof kind !== 'string') throw new UsageContractError('GrokObservation.kind must be a string')

  if (kind === 'NUMERIC_USAGE_AVAILABLE') {
    assertNoUnknownKeys(obj, ['kind', 'windows'], 'GrokNumericUsageObservation')
    if (!Array.isArray(obj.windows)) throw new UsageContractError('GrokNumericUsageObservation.windows must be an array')

    const windows: LimitWindow[] = obj.windows.map((raw, idx) => {
      const window = assertPlainObject(raw, `GrokNumericUsageObservation.windows[${idx}]`)
      const windowKind = window.windowKind as LimitWindowKind
      const win: LimitWindow = {
        id: `grok-${String(window.id ?? idx)}`,
        label: String(window.label ?? ''),
        kind: windowKind,
        usedPercent: Number(window.usedPercent),
        scope: {
          kind: 'PROVIDER',
          ...(typeof window.tierLabel === 'string' && window.tierLabel.trim().length > 0
            ? { label: window.tierLabel.trim() }
            : {}),
        },
      }
      if (window.resetsAtMs !== undefined) win.resetsAtMs = Number(window.resetsAtMs)
      if (window.windowDurationMs !== undefined) win.windowDurationMs = Number(window.windowDurationMs)
      return win
    })

    return parseProviderUsageSnapshot({
      providerId: GROK_PROVIDER_ID,
      displayName: GROK_DISPLAY_NAME,
      status: 'AVAILABLE',
      observedAtMs,
      windows,
      source: numericSourceMetadata(),
    })
  }

  assertNoUnknownKeys(obj, ['kind'], 'GrokCapabilityObservation')
  let status: ProviderUsageStatus
  switch (kind) {
    case 'UNAVAILABLE':
      status = 'UNAVAILABLE'
      break
    default:
      throw new UsageContractError(`Unrecognized Grok capability observation kind "${kind}"`)
  }

  return parseProviderUsageSnapshot({
    providerId: GROK_PROVIDER_ID,
    displayName: GROK_DISPLAY_NAME,
    status,
    observedAtMs,
    windows: [],
    source: defaultSourceMetadata(),
  })
}

const GROK_COLLECTOR_SPEC: VendorUsageCollectorSpec<GrokObservation> = {
  providerId: GROK_PROVIDER_ID,
  displayName: GROK_DISPLAY_NAME,
  sourceMetadata: defaultSourceMetadata,
  sourceErrorCode: (err) => (err instanceof GrokUsageSourceError ? err.code : undefined),
  normalize: normalizeGrokUsage,
}

export class GrokUsageCollector extends VendorUsageCollector<GrokObservation> {
  constructor(source: GrokUsageCapabilitySource) {
    super(source, GROK_COLLECTOR_SPEC)
  }
}
