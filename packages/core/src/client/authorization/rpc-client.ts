/** Browser-side RPC Client for Model Accounts status. */

import type { ClientConnectionRpcLike } from '../rpc-client.js'
import type {
  AuthorizationUiState,
  SafeAuthorizationFlowDto,
} from './types.js'

export const AUTHORIZATION_RPC_CHANNEL = '/authorization'
export const GENERIC_AUTH_CLIENT_ERROR = 'Authorization service is unavailable.'

export interface AuthorizationBrowserRpc {
  listFlows(): Promise<SafeAuthorizationFlowDto[]>
  getProviderStatus(providerId: string): Promise<SafeAuthorizationFlowDto | null>
  refresh(providerId?: string): Promise<SafeAuthorizationFlowDto | SafeAuthorizationFlowDto[]>
}

function parseSafeFlowDto(raw: unknown): SafeAuthorizationFlowDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Malformed authorization flow DTO')
  }

  const obj = raw as Record<string, unknown>
  if (typeof obj.providerId !== 'string' || typeof obj.status !== 'string') {
    throw new Error('Malformed authorization flow DTO fields')
  }

  const credentialKind: 'api-key' | 'grant' | undefined =
    obj.credentialKind === 'grant' || obj.credentialKind === 'api-key' ? obj.credentialKind : undefined

  const rawStatus = typeof obj.status === 'string' ? obj.status : 'NOT_CONFIGURED'
  const safeStatus: AuthorizationUiState =
    rawStatus === 'CONNECTED' || rawStatus === 'ERROR' ? rawStatus : 'NOT_CONFIGURED'

  return {
    providerId: obj.providerId,
    label: typeof obj.label === 'string' ? obj.label : obj.providerId,
    configured: Boolean(obj.configured),
    credentialKind,
    status: safeStatus,
    lastError: typeof obj.lastError === 'string' ? obj.lastError : undefined,
  }
}

export class AuthorizationBrowserRpcClient implements AuthorizationBrowserRpc {
  private readonly rpc: ClientConnectionRpcLike

  constructor(rpc: ClientConnectionRpcLike) {
    this.rpc = rpc
  }

  async listFlows(): Promise<SafeAuthorizationFlowDto[]> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'list-flows', {})
      if (!res || !res.ok || !Array.isArray(res.value)) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
      return res.value.map((item) => parseSafeFlowDto(item))
    } catch {
      throw new Error(GENERIC_AUTH_CLIENT_ERROR)
    }
  }

  async getProviderStatus(providerId: string): Promise<SafeAuthorizationFlowDto | null> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'get-provider-status', { providerId })
      if (!res || !res.ok) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
      if (res.value === null || res.value === undefined) return null
      return parseSafeFlowDto(res.value)
    } catch {
      throw new Error(GENERIC_AUTH_CLIENT_ERROR)
    }
  }

  async refresh(providerId?: string): Promise<SafeAuthorizationFlowDto | SafeAuthorizationFlowDto[]> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'refresh', providerId ? { providerId } : {})
      if (!res || !res.ok) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
      if (Array.isArray(res.value)) return res.value.map((item) => parseSafeFlowDto(item))
      return parseSafeFlowDto(res.value)
    } catch {
      throw new Error(GENERIC_AUTH_CLIENT_ERROR)
    }
  }
}
