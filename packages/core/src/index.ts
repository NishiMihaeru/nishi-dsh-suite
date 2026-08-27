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

  constructor(ctx: Context, config?: UsageLimitsHostConfig) {
    super(ctx, 'usageLimits')
    this.#ctx = ctx
    const clock = config?.clock ?? (() => Date.now())
    const { service, facade } = composeUsageLimitsHost(ctx, config, clock)
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
   * Which providers the browser should render, derived from registrations.
   * Only providers that declare a usage capability appear: a provider with no
   * usage source has nothing to show in this surface, and an empty row would
   * be the grey blank this record exists to remove.
   */
  getRosterPublic(): ProviderRosterRow[] {
    return this.#ctx.nishiProviders.all()
      .filter((provider) => provider.usage !== undefined)
      .map((provider) => ({ providerId: provider.id, presentation: provider.presentation }))
  }

  getCachedProvidersPublic(): PublicProviderUsage[] {
    return this.#publicFacade.getCachedProviders()
  }

  getCachedProviderPublic(providerId: string): PublicProviderUsage | undefined {
    return this.#publicFacade.getCachedProvider(providerId)
  }

  async refreshProviderPublic(providerId: string, options?: { force?: boolean }): Promise<PublicProviderUsage> {
    return this.#publicFacade.refreshProvider(providerId, options)
  }

  isRegisteredProvider(providerId: string): boolean {
    if (typeof providerId !== 'string' || providerId.trim().length === 0) return false
    return this.#service.getRegisteredProviderIds().includes(providerId.trim())
  }

  invalidateProvider(providerId: string): void {
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
