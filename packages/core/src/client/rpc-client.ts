import {
  parsePublicProviderUsage,
  type PublicProviderUsage,
} from '../usage/index.js'

/** Provider identity as it crosses RPC: data only, never a component. */
export interface ProviderPresentation {
  id: string
  displayName: string
  brandColor: string
  iconPath?: string
  bucketsAsPools?: boolean
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

/**
 * Validate one roster row from the host. An icon path is dropped rather than
 * trusted blindly if it is not a string, and a provider with none renders the
 * neutral mark — a supported outcome, not a broken row.
 */
function parseProviderRosterEntry(value: unknown): ProviderRosterEntry {
  const row = (value ?? {}) as Record<string, unknown>
  const presentation = (row.presentation ?? {}) as Record<string, unknown>
  const providerId = nonEmptyString(row.providerId, '')
  if (providerId === '') throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
  return {
    providerId,
    presentation: {
      id: nonEmptyString(presentation.id, providerId),
      displayName: nonEmptyString(presentation.displayName, providerId),
      brandColor: nonEmptyString(presentation.brandColor, NEUTRAL_BRAND_COLOR),
      ...(typeof presentation.iconPath === 'string' && presentation.iconPath.trim().length > 0
        ? { iconPath: presentation.iconPath }
        : {}),
      ...(typeof presentation.bucketsAsPools === 'boolean'
        ? { bucketsAsPools: presentation.bucketsAsPools }
        : {}),
    },
  }
}

/** Used when a provider declares no colour, and by the neutral mark. */
export const NEUTRAL_BRAND_COLOR = '#7C8AA5'

export const USAGE_LIMITS_RPC_CHANNEL = '/usage-limits'
export const GENERIC_CLIENT_ERROR_MESSAGE = 'Usage data is unavailable.'

export interface ClientConnectionRpcLike {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: unknown }>
}

export interface ProviderRosterEntry {
  providerId: string
  presentation: ProviderPresentation
}

export interface UsageLimitsBrowserRpc {
  getRoster(): Promise<ProviderRosterEntry[]>
  getProviders(): Promise<PublicProviderUsage[]>
  getProvider(providerId: string): Promise<PublicProviderUsage | null>
  refreshProvider(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage>
}

export class UsageLimitsBrowserRpcClient implements UsageLimitsBrowserRpc {
  constructor(private readonly rpc: ClientConnectionRpcLike) {}

  /**
   * Ask the host which providers exist. The browser no longer ships a list:
   * a provider mounted late appears here, and one that is not mounted never
   * becomes a row.
   */
  async getRoster(): Promise<ProviderRosterEntry[]> {
    try {
      const res = await this.rpc.call(USAGE_LIMITS_RPC_CHANNEL, 'get-roster', {})
      if (!res?.ok || !Array.isArray(res.value)) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
      return res.value.map((item) => parseProviderRosterEntry(item))
    } catch {
      throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    }
  }

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
