import { Context, Service } from '@deepseek-ai/cordis'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { NishiProvidersService } from './registry/service.js'
import type { HiddenModel } from './model-visibility.js'
import type { PublicProviderUsage, UsageLimitsPublicFacade, UsageLimitsService } from './usage/index.js'
import {
  composeUsageLimitsHost,
  type UsageLimitsHostConfig,
  type UsageLimitsHostDependencies,
  DEFAULT_USAGE_REFRESH_POLICY,
} from './host/composition.js'
import { registerConnectionRpcChannel } from './host/connection-compat.js'
import {
  USAGE_LIMITS_CHANNEL,
  USAGE_LIMITS_GET_ROSTER_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDERS_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDER_ENDPOINT,
  USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT,
  MODEL_VISIBILITY_GET_ENDPOINT,
  MODEL_VISIBILITY_SET_ENDPOINT,
  createUsageLimitsRpcHandler,
  type ProviderRosterRow,
  type ModelVisibilityRpcValue,
  type SetHiddenModelsRpcRequest,
  type GetRosterRpcRequest,
  type GetProvidersRpcRequest,
  type GetProviderRpcRequest,
  type RefreshProviderRpcRequest,
  type UsageLimitsRpcHost,
} from './host/rpc.js'

export {
  USAGE_LIMITS_CHANNEL,
  USAGE_LIMITS_GET_ROSTER_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDERS_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDER_ENDPOINT,
  USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT,
  MODEL_VISIBILITY_GET_ENDPOINT,
  MODEL_VISIBILITY_SET_ENDPOINT,
  createUsageLimitsRpcHandler,
  type ProviderRosterRow,
  type ModelVisibilityRpcValue,
  type SetHiddenModelsRpcRequest,
  type GetRosterRpcRequest,
  type GetProvidersRpcRequest,
  type GetProviderRpcRequest,
  type RefreshProviderRpcRequest,
  type UsageLimitsRpcHost,
  type UsageLimitsHostConfig,
  type UsageLimitsHostDependencies,
  DEFAULT_USAGE_REFRESH_POLICY,
}

/**
 * The usage/limits domain is part of this package now, not a sibling one, so
 * its contract, collectors and public projection are re-exported here rather
 * than imported across a package boundary.
 */
export * from './usage/index.js'
export * from './model-visibility.js'
export { NishiProvidersService } from './registry/service.js'
export type {
  ModelCapability,
  ProviderPresentation,
  ProviderDescriptor,
  RegisteredProvider,
} from './registry/descriptor.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageLimits: UsageLimitsHostService
  }
}

export class UsageLimitsHostService extends Service {
  readonly #service: UsageLimitsService
  readonly #publicFacade: UsageLimitsPublicFacade
  readonly #ctx: Context
  readonly #clock: () => number

  constructor(ctx: Context, config?: UsageLimitsHostConfig) {
    super(ctx, 'usageLimits')
    this.#ctx = ctx
    this.#clock = config?.clock ?? (() => Date.now())
    const { service, facade } = composeUsageLimitsHost(ctx, config, this.#clock)
    this.#service = service
    this.#publicFacade = facade
    this.getRosterPublic = this.getRosterPublic.bind(this)
    this.getCachedProvidersPublic = this.getCachedProvidersPublic.bind(this)
    this.getCachedProviderPublic = this.getCachedProviderPublic.bind(this)
    this.refreshProviderPublic = this.refreshProviderPublic.bind(this)
    this.isRegisteredProvider = this.isRegisteredProvider.bind(this)
    this.invalidateProvider = this.invalidateProvider.bind(this)
    this.getModelVisibilityPublic = this.getModelVisibilityPublic.bind(this)
    this.setHiddenModelsPublic = this.setHiddenModelsPublic.bind(this)
  }

  /**
   * Which providers the browser should render, derived from all live provider
   * registrations. Capability absence is itself meaningful data: a provider
   * without a usage collector still gets a row whose public usage status is
   * `UNSUPPORTED`, rather than disappearing from the surface.
   */
  getRosterPublic(): ProviderRosterRow[] {
    return this.#ctx.nishiProviders.all()
      .map((provider) => ({ providerId: provider.id, presentation: provider.presentation }))
  }

  /** Project the descriptor-level absence of usage into the normal public DTO. */
  #unsupportedProvider(providerId: string, displayName: string): PublicProviderUsage {
    return {
      providerId,
      displayName,
      status: 'UNSUPPORTED',
      observedAtMs: this.#clock(),
      freshness: 'UNKNOWN',
      windows: [],
    }
  }

  getCachedProvidersPublic(): PublicProviderUsage[] {
    const cached = new Map(
      this.#publicFacade.getCachedProviders().map((usage) => [usage.providerId, usage] as const),
    )
    const result: PublicProviderUsage[] = []
    for (const provider of this.#ctx.nishiProviders.all()) {
      if (provider.usage === undefined) {
        result.push(this.#unsupportedProvider(provider.id, provider.presentation.displayName))
        continue
      }
      const usage = cached.get(provider.id)
      if (usage !== undefined) result.push(usage)
    }
    return result
  }

  getCachedProviderPublic(providerId: string): PublicProviderUsage | undefined {
    const provider = this.#ctx.nishiProviders.byId(providerId)
    if (provider === undefined) return undefined
    if (provider.usage === undefined) {
      return this.#unsupportedProvider(provider.id, provider.presentation.displayName)
    }
    return this.#publicFacade.getCachedProvider(providerId)
  }

  async refreshProviderPublic(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage> {
    const provider = this.#ctx.nishiProviders.byId(providerId)
    if (provider === undefined) throw new Error(`Provider "${providerId}" is not registered`)
    if (provider.usage === undefined) {
      return this.#unsupportedProvider(provider.id, provider.presentation.displayName)
    }
    return this.#publicFacade.refreshProvider(providerId, options)
  }

  async getModelVisibilityPublic(): Promise<ModelVisibilityRpcValue> {
    const groups = await Promise.all(this.#ctx.nishiProviders.all().flatMap((provider) => {
      if (provider.descriptor.model === undefined) return []
      return provider.routes.map(async (route) => {
        let models: readonly LlmModelInfo[] = []
        try {
          models = await this.#ctx.nishiProviders.listModelsUnfiltered(provider.id, route)
        } catch {
          // One unavailable vendor must not hide every other provider's controls.
        }
        return {
          provider: route,
          displayName: provider.routes.length === 1
            ? provider.presentation.displayName
            : `${provider.presentation.displayName} · ${route}`,
          models: models.map((model) => ({
            provider: route,
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          })),
        }
      })
    }))
    return { groups, hidden: this.#ctx.nishiProviders.hiddenModels() }
  }

  setHiddenModelsPublic(models: readonly HiddenModel[]): readonly HiddenModel[] {
    const changed = this.#ctx.nishiProviders.setHiddenModels(models)
    if (changed) this.#ctx.emit('llm/adapters-updated')
    return this.#ctx.nishiProviders.hiddenModels()
  }

  isRegisteredProvider(providerId: string): boolean {
    return typeof providerId === 'string' && this.#ctx.nishiProviders.byId(providerId) !== undefined
  }

  invalidateProvider(providerId: string): void {
    const provider = this.#ctx.nishiProviders.byId(providerId)
    if (provider?.usage === undefined) return
    this.#service.invalidate(providerId)
  }
}

export const name = 'nishi-core'

/**
 * The outer plugin owns no external service access. It publishes the provider
 * registry first, then mounts a child host plugin whose own Cordis injection
 * contract permits access to that registry plus connection and credentials.
 * This avoids the impossible cycle where nishi-core would have to inject the
 * nishiProviders service that it is itself responsible for creating.
 */
export const inject = [] as const

function hostPlugin(config?: UsageLimitsHostConfig) {
  return {
    name: 'nishi-core-host',
    inject: ['nishiProviders', 'connection', 'credentials'] as const,
    apply(hostCtx: Context): void {
      const hostService = new UsageLimitsHostService(hostCtx, config)
      registerConnectionRpcChannel(
        hostCtx.connection.rpc,
        USAGE_LIMITS_CHANNEL,
        createUsageLimitsRpcHandler(hostService),
      )
    },
  }
}

export function apply(ctx: Context, config?: UsageLimitsHostConfig): void {
  ctx.plugin(NishiProvidersService)
  ctx.plugin(hostPlugin(config))
}

export const NishiCorePlugin = { name, inject, apply }
export default NishiCorePlugin
