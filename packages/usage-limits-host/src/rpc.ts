import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult, RpcError } from '@deepseek-ai/dsh-host-apiproxy'
import {
  parsePublicProviderUsage,
  type PublicProviderUsage,
} from 'nishi-dsh-usage-limits'

export const USAGE_LIMITS_CHANNEL = '/usage-limits'
export const USAGE_LIMITS_GET_PROVIDERS_ENDPOINT = 'get-providers'
export const USAGE_LIMITS_GET_PROVIDER_ENDPOINT = 'get-provider'
export const USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT = 'refresh-provider'

export type GetProvidersRpcRequest = Record<string, never>
export interface GetProviderRpcRequest { providerId: string }
export interface RefreshProviderRpcRequest { providerId: string; force?: boolean }

export interface UsageLimitsRpcHost {
  getCachedProvidersPublic(): PublicProviderUsage[]
  getCachedProviderPublic(providerId: string): PublicProviderUsage | undefined
  refreshProviderPublic(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage>
  isRegisteredProvider(providerId: string): boolean
}

const GENERIC_BAD_REQUEST_MESSAGE = 'Invalid usage limits request.'
const GENERIC_INTERNAL_ERROR_MESSAGE = 'Usage limits operation failed.'
const MAX_PROVIDER_ID_LENGTH = 64

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
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
          const rawId = payload.providerId
          if (typeof rawId !== 'string') return createBadRequestResult()
          const trimmedId = rawId.trim()
          if (trimmedId.length === 0 || rawId.length > MAX_PROVIDER_ID_LENGTH) return createBadRequestResult()
          if (!host.isRegisteredProvider(trimmedId)) return createBadRequestResult()
          const cached = host.getCachedProviderPublic(trimmedId)
          return { ok: true, value: cached === undefined ? null : parsePublicProviderUsage(cached) }
        }
        case USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT: {
          if (!isPlainObject(payload)) return createBadRequestResult()
          const keys = Object.keys(payload)
          if (!keys.includes('providerId') || keys.some((key) => key !== 'providerId' && key !== 'force')) return createBadRequestResult()
          const rawId = payload.providerId
          if (typeof rawId !== 'string') return createBadRequestResult()
          const trimmedId = rawId.trim()
          if (trimmedId.length === 0 || rawId.length > MAX_PROVIDER_ID_LENGTH) return createBadRequestResult()
          let force: boolean | undefined
          if ('force' in payload) {
            if (typeof payload.force !== 'boolean') return createBadRequestResult()
            force = payload.force
          }
          if (!host.isRegisteredProvider(trimmedId)) return createBadRequestResult()
          const refreshed = await host.refreshProviderPublic(trimmedId, force === undefined ? undefined : { force })
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
