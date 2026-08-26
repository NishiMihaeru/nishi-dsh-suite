import {
  parsePublicProviderUsage,
  type PublicProviderUsage,
} from 'nishi-dsh-usage-limits'

export const USAGE_LIMITS_RPC_CHANNEL = '/usage-limits'
export const GENERIC_CLIENT_ERROR_MESSAGE = 'Usage data is unavailable.'

export interface ClientConnectionRpcLike {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: unknown }>
}

export interface UsageLimitsBrowserRpc {
  getProviders(): Promise<PublicProviderUsage[]>
  getProvider(providerId: string): Promise<PublicProviderUsage | null>
  refreshProvider(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage>
}

export class UsageLimitsBrowserRpcClient implements UsageLimitsBrowserRpc {
  constructor(private readonly rpc: ClientConnectionRpcLike) {}

  async getProviders(): Promise<PublicProviderUsage[]> {
    try {
      const res = await this.rpc.call(USAGE_LIMITS_RPC_CHANNEL, 'get-providers', {})
      if (!res?.ok || !Array.isArray(res.value)) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
      return res.value.map((item) => parsePublicProviderUsage(item))
    } catch {
      throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    }
  }

  async getProvider(providerId: string): Promise<PublicProviderUsage | null> {
    try {
      const res = await this.rpc.call(USAGE_LIMITS_RPC_CHANNEL, 'get-provider', { providerId })
      if (!res?.ok) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
      if (res.value === null || res.value === undefined) return null
      return parsePublicProviderUsage(res.value)
    } catch {
      throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    }
  }

  async refreshProvider(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage> {
    try {
      const res = await this.rpc.call(USAGE_LIMITS_RPC_CHANNEL, 'refresh-provider', {
        providerId,
        ...(options?.force !== undefined ? { force: options.force } : {}),
      })
      if (!res?.ok) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
      return parsePublicProviderUsage(res.value)
    } catch {
      throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    }
  }
}
