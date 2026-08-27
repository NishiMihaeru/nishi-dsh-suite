import { Context, Service } from '@deepseek-ai/cordis'
import { NishiProvidersService } from './registry/service.js'
import type { PublicProviderUsage, UsageLimitsPublicFacade, UsageLimitsService } from './usage/index.js'
import {
  composeUsageLimitsHost,
  type UsageLimitsHostConfig,
  type UsageLimitsHostDependencies,
  DEFAULT_USAGE_REFRESH_POLICY,
} from './host/composition.js'
import {
  USAGE_LIMITS_CHANNEL,
  USAGE_LIMITS_GET_ROSTER_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDERS_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDER_ENDPOINT,
  USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT,
  createUsageLimitsRpcHandler,
  type ProviderRosterRow,
  type GetRosterRpcRequest,
  type GetProvidersRpcRequest,
  type GetProviderRpcRequest,
  type RefreshProviderRpcRequest,
  type UsageLimitsRpcHost,
} from './host/rpc.js'
import {
  AUTHORIZATION_RPC_CHANNEL,
  AUTH_GET_FLOWS_ENDPOINT,
  AUTH_GET_STATUS_ENDPOINT,
  AUTH_BEGIN_LOGIN_ENDPOINT,
  AUTH_SUBMIT_PROMPT_ENDPOINT,
  AUTH_CANCEL_LOGIN_ENDPOINT,
  AUTH_LOGOUT_ENDPOINT,
  AUTH_REFRESH_ENDPOINT,
  AuthorizationHostController,
  createAuthorizationRpcHandler,
  type AuthorizationUiState,
  type SafeAuthorizationFlowDto,
  type SafeAuthorizationNoticeDto,
  type SafeAuthorizationPromptDto,
  type SafeAuthorizationPromptOptionDto,
  type BeginLoginRpcRequest,
  type SubmitPromptRpcRequest,
  type CancelLoginRpcRequest,
  type LogoutRpcRequest,
  type RefreshRpcRequest,
} from './host/authorization-rpc.js'

export {
  USAGE_LIMITS_CHANNEL,
  USAGE_LIMITS_GET_ROSTER_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDERS_ENDPOINT,
  USAGE_LIMITS_GET_PROVIDER_ENDPOINT,
  USAGE_LIMITS_REFRESH_PROVIDER_ENDPOINT,
  createUsageLimitsRpcHandler,
  type ProviderRosterRow,
  type GetRosterRpcRequest,
  type GetProvidersRpcRequest,
  type GetProviderRpcRequest,
  type RefreshProviderRpcRequest,
  type UsageLimitsRpcHost,
  type UsageLimitsHostConfig,
  type UsageLimitsHostDependencies,
  DEFAULT_USAGE_REFRESH_POLICY,
  AUTHORIZATION_RPC_CHANNEL,
  AUTH_GET_FLOWS_ENDPOINT,
  AUTH_GET_STATUS_ENDPOINT,
  AUTH_BEGIN_LOGIN_ENDPOINT,
  AUTH_SUBMIT_PROMPT_ENDPOINT,
  AUTH_CANCEL_LOGIN_ENDPOINT,
  AUTH_LOGOUT_ENDPOINT,
  AUTH_REFRESH_ENDPOINT,
  AuthorizationHostController,
  createAuthorizationRpcHandler,
  type AuthorizationUiState,
  type SafeAuthorizationFlowDto,
  type SafeAuthorizationNoticeDto,
  type SafeAuthorizationPromptDto,
  type SafeAuthorizationPromptOptionDto,
  type BeginLoginRpcRequest,
  type SubmitPromptRpcRequest,
  type CancelLoginRpcRequest,
  type LogoutRpcRequest,
  type RefreshRpcRequest,
}

/**
 * The usage/limits domain is part of this package now, not a sibling one, so
 * its contract, collectors and public projection are re-exported here rather
 * than imported across a package boundary.
 */
export * from './usage/index.js'
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
export const inject = ['connection', 'subprocess', 'authorization', 'credentials'] as const

export function apply(ctx: Context, config?: UsageLimitsHostConfig): void {
  ctx.plugin(NishiProvidersService)

  const hostService = new UsageLimitsHostService(ctx, config)
  ctx.connection.rpc.handle(
    USAGE_LIMITS_CHANNEL,
    createUsageLimitsRpcHandler(hostService),
    { authority: 'trusted-host' },
  )

  const authController = new AuthorizationHostController(ctx)
  ctx.connection.rpc.handle(
    AUTHORIZATION_RPC_CHANNEL,
    createAuthorizationRpcHandler(authController),
    { authority: 'trusted-host' },
  )
}

export const NishiCorePlugin = { name, inject, apply }
export default NishiCorePlugin
