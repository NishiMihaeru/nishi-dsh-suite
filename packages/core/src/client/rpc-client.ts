import {
  parsePublicProviderUsage,
  type PublicProviderUsage,
} from '../usage/index.js'
import {
  normalizeHiddenModels,
  type HiddenModel,
  type ModelVisibilityGroup,
} from '../model-visibility.js'

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
function parseModelVisibility(value: unknown): ModelVisibilityValue {
  const root = (value ?? {}) as Record<string, unknown>
  if (!Array.isArray(root.groups) || !Array.isArray(root.hidden)) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
  const groups: ModelVisibilityGroup[] = root.groups.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    const provider = nonEmptyString(row.provider, '')
    const displayName = nonEmptyString(row.displayName, provider)
    if (provider === '' || !Array.isArray(row.models)) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    return {
      provider,
      displayName,
      models: row.models.map((item) => {
        const model = (item ?? {}) as Record<string, unknown>
        const id = nonEmptyString(model.id, '')
        if (id === '') throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
        return {
          provider,
          id,
          name: nonEmptyString(model.name, id),
          ...(typeof model.description === 'string' ? { description: model.description } : {}),
        }
      }),
    }
  })
  return { groups, hidden: normalizeHiddenModels(root.hidden) }
}

export const NEUTRAL_BRAND_COLOR = '#7C8AA5'

export const USAGE_LIMITS_RPC_CHANNEL = '/usage-limits'
export const GENERIC_CLIENT_ERROR_MESSAGE = 'Usage data is unavailable.'
export const MODEL_VISIBILITY_GET_ENDPOINT = 'get-model-visibility'
export const MODEL_VISIBILITY_SET_ENDPOINT = 'set-hidden-models'

export interface ModelVisibilityValue {
  groups: readonly ModelVisibilityGroup[]
  hidden: readonly HiddenModel[]
}

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

export interface ModelVisibilityBrowserRpc {
  getModelVisibility(): Promise<ModelVisibilityValue>
  setHiddenModels(models: readonly HiddenModel[]): Promise<readonly HiddenModel[]>
}

export class UsageLimitsBrowserRpcClient implements UsageLimitsBrowserRpc, ModelVisibilityBrowserRpc {
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

  async getModelVisibility(): Promise<ModelVisibilityValue> {
    try {
      const res = await this.rpc.call(USAGE_LIMITS_RPC_CHANNEL, MODEL_VISIBILITY_GET_ENDPOINT, {})
      if (!res?.ok) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
      return parseModelVisibility(res.value)
    } catch {
      throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    }
  }

  async setHiddenModels(models: readonly HiddenModel[]): Promise<readonly HiddenModel[]> {
    try {
      const res = await this.rpc.call(USAGE_LIMITS_RPC_CHANNEL, MODEL_VISIBILITY_SET_ENDPOINT, { models })
      if (!res?.ok) throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
      return normalizeHiddenModels(res.value)
    } catch {
      throw new Error(GENERIC_CLIENT_ERROR_MESSAGE)
    }
  }
}
