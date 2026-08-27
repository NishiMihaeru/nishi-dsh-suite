import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult, RpcError } from '@deepseek-ai/dsh-host-apiproxy'
import type { ProviderPresentation } from '../registry/descriptor.js'
import { canonicalProviderId } from '../registry/identity.js'
import {
  parsePublicProviderUsage,
  type PublicProviderUsage,
} from '../usage/index.js'

export const USAGE_LIMITS_CHANNEL = '/usage-limits'
export const USAGE_LIMITS_GET_ROSTER_ENDPOINT = 'get-roster'
export const USAGE_LIMITS_GET_PROVIDERS_ENDPOINT = 'get-providers'
export const USAGE_LIMITS_GET_PROVIDER_ENDPOINT = 'get-provider'
export const USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT = 'refresh-provider'

export type GetRosterRpcRequest = Record<string, never>
export type GetProvidersRpcRequest = Record<string, never>

/**
 * One row of the roster the browser renders from. It answers "which providers
 * exist and how do they look", which is a different question from "what is
 * their usage" — a provider with no snapshot yet must still appear, and one
 * that is not mounted must not.
 */
export interface ProviderRosterRow {
  providerId: string
  presentation: ProviderPresentation
}
export interface GetProviderRpcRequest { providerId: string }
export interface RefreshProviderRpcRequest { providerId: string; force?: boolean }

export interface UsageLimitsRpcHost {
  getRosterPublic(): ProviderRosterRow[]
  getCachedProvidersPublic(): PublicProviderUsage[]
  getCachedProviderPublic(providerId: string): PublicProviderUsage | undefined
  refreshProviderPublic(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage>
  isRegisteredProvider(providerId: string): boolean
}

/**
 * Project one roster row for the browser, dropping anything a provider put on
 * its presentation that this contract does not define. The browser renders
 * this straight into the DOM, so the shape crossing the boundary is fixed
 * here rather than trusted from the descriptor.
 */
function parseProviderRosterRow(row: ProviderRosterRow): ProviderRosterRow {
  const presentation = row.presentation
  return {
    providerId: row.providerId,
    presentation: {
      id: presentation.id,
      displayName: presentation.displayName,
      brandColor: presentation.brandColor,
      ...(presentation.iconPath === undefined ? {} : { iconPath: presentation.iconPath }),
      ...(presentation.bucketsAsPools === undefined ? {} : { bucketsAsPools: presentation.bucketsAsPools }),
    },
  }
}

const GENERIC_BAD_REQUEST_MESSAGE = 'Invalid usage limits request.'
const GENERIC_INTERNAL_ERROR_MESSAGE = 'Usage limits operation failed.'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function requestProviderId(value: unknown): string | undefined {
  try {
    return canonicalProviderId(value, 'usage limits providerId')
  } catch {
    return undefined
  }
}

function createBadRequestResult(): RpcResult<never> {
  const error: RpcError = {
    code: 'bad-request',
    message: GENERIC_BAD_REQUEST_MESSAGE,
    details: { issues: [{ message: GENERIC_BAD_REQUEST_MESSAGE } as any] },
  }
  return { ok: false, error }
}

function createInternalErrorResult(): RpcResult<never> {
  return {
    ok: false,
    error: { code: 'internal', message: GENERIC_INTERNAL_ERROR_MESSAGE, details: {} },
  }
}

export function createUsageLimitsRpcHandler(host: UsageLimitsRpcHost): ConnectionRpcHandler {
  return async (endpoint: string, payload: unknown, _signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        case USAGE_LIMITS_GET_ROSTER_ENDPOINT: {
          if (!isPlainObject(payload) || Object.keys(payload).length !== 0) return createBadRequestResult()
          return { ok: true, value: host.getRosterPublic().map((row) => parseProviderRosterRow(row)) }
        }
        case USAGE_LIMITS_GET_PROVIDERS_ENDPOINT: {
          if (!isPlainObject(payload) || Object.keys(payload).length !== 0) return createBadRequestResult()
          return {
            ok: true,
            value: host.getCachedProvidersPublic().map((dto) => parsePublicProviderUsage(dto)),
          }
        }
        case USAGE_LIMITS_GET_PROVIDER_ENDPOINT: {
          if (!isPlainObject(payload)) return createBadRequestResult()
          const keys = Object.keys(payload)
          if (keys.length !== 1 || keys[0] !== 'providerId') return createBadRequestResult()
          const providerId = requestProviderId(payload.providerId)
          if (providerId === undefined || !host.isRegisteredProvider(providerId)) return createBadRequestResult()
          const cached = host.getCachedProviderPublic(providerId)
          return { ok: true, value: cached === undefined ? null : parsePublicProviderUsage(cached) }
        }
        case USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT: {
          if (!isPlainObject(payload)) return createBadRequestResult()
          const keys = Object.keys(payload)
          if (!keys.includes('providerId') || keys.some((key) => key !== 'providerId' && key !== 'force')) return createBadRequestResult()
          const providerId = requestProviderId(payload.providerId)
          if (providerId === undefined) return createBadRequestResult()
          let force: boolean | undefined
          if ('force' in payload) {
            if (typeof payload.force !== 'boolean') return createBadRequestResult()
            force = payload.force
          }
          if (!host.isRegisteredProvider(providerId)) return createBadRequestResult()
          const refreshed = await host.refreshProviderPublic(providerId, force === undefined ? undefined : { force })
          return { ok: true, value: parsePublicProviderUsage(refreshed) }
        }
        default:
          return createBadRequestResult()
      }
    } catch {
      return createInternalErrorResult()
    }
  }
}
