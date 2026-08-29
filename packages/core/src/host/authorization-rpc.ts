/**
 * Cordis Connection RPC handler for the Model Accounts status surface.
 * Subscription OAuth is intentionally not initiated by DSH. This bridge only
 * reports legacy DSH grants; token material is never projected to the browser.
 *
 * The roster is not a fixed list of vendor ids: every row comes from a live
 * provider's own `descriptor.account` declaration (credential scope/id/label),
 * read through the registry the same way the Usage plane derives its roster
 * from registrations instead of naming providers. A provider that never
 * declares `account` gets no Model Accounts row — that is a legal, declared
 * state, not a gap to paper over.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { AccountCapability } from '../registry/descriptor.js'

export const AUTHORIZATION_RPC_CHANNEL = '/authorization'
export const AUTH_GET_FLOWS_ENDPOINT = 'list-flows'
export const AUTH_GET_STATUS_ENDPOINT = 'get-provider-status'
export const AUTH_REFRESH_ENDPOINT = 'refresh'

export type AuthorizationUiState = 'NOT_CONFIGURED' | 'CONNECTED' | 'ERROR'
export interface SafeAuthorizationFlowDto {
  providerId: string
  label: string
  configured: boolean
  credentialKind?: 'api-key' | 'grant'
  status: AuthorizationUiState
  lastError?: string
}
export interface RefreshRpcRequest { providerId?: string }

type ConnectionRpcResult = Awaited<ReturnType<ConnectionRpcHandler>>
type ConnectionRpcError = Extract<ConnectionRpcResult, { ok: false }>['error']

const GENERIC_BAD_REQUEST_MESSAGE = 'Invalid authorization request.'
const GENERIC_INTERNAL_ERROR_MESSAGE = 'Authorization operation failed.'
const GENERIC_STATE_UNAVAILABLE_MESSAGE = 'Authorization state is unavailable.'
const MAX_PROVIDER_ID_LENGTH = 64

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
function createBadRequestResult(): ConnectionRpcResult {
  const error: ConnectionRpcError = {
    code: 'bad-request',
    message: GENERIC_BAD_REQUEST_MESSAGE,
    details: { issues: [{ message: GENERIC_BAD_REQUEST_MESSAGE } as any] },
  }
  return { ok: false, error }
}
function createInternalErrorResult(): ConnectionRpcResult {
  const error: ConnectionRpcError = { code: 'internal', message: GENERIC_INTERNAL_ERROR_MESSAGE, details: {} }
  return { ok: false, error }
}
/**
 * Shape only. Whether a live provider actually owns this id is a registry
 * question the controller answers, not something a parser can decide.
 */
function isWellFormedProviderId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PROVIDER_ID_LENGTH && value.trim() === value
}

export class AuthorizationHostController {
  constructor(private readonly ctx: Context) {}

  /** Live providers that opted into a Model Accounts row, keyed by their canonical Nishi provider id. */
  #accountProviders(): Map<string, AccountCapability> {
    const result = new Map<string, AccountCapability>()
    for (const provider of this.ctx.nishiProviders?.all() ?? []) {
      if (provider.descriptor.account !== undefined) result.set(provider.id, provider.descriptor.account)
    }
    return result
  }

  async #describeAccount(providerId: string, account: AccountCapability): Promise<SafeAuthorizationFlowDto> {
    const key = credentialKey(account.credentialScope, account.credentialId)

    let configured = false
    let credentialKind: 'api-key' | 'grant' | undefined
    let storageUnavailable = false
    if (this.ctx.credentials) {
      try {
        const desc = await this.ctx.credentials.describeRecord(key)
        configured = Boolean(desc?.configured)
        if (desc?.kind === 'grant' || desc?.kind === 'api-key') credentialKind = desc.kind
      } catch {
        configured = false
        credentialKind = undefined
        storageUnavailable = true
      }
    }

    return {
      providerId,
      label: account.label,
      configured,
      credentialKind,
      status: storageUnavailable
        ? 'ERROR'
        : configured && credentialKind === 'grant'
          ? 'CONNECTED'
          : 'NOT_CONFIGURED',
      ...(storageUnavailable ? { lastError: GENERIC_STATE_UNAVAILABLE_MESSAGE } : {}),
    }
  }

  /**
   * `undefined` means no live provider owns this id — a bad request from the
   * RPC handler's point of view, never an internal error.
   */
  async describeProviderPublic(providerId: string): Promise<SafeAuthorizationFlowDto | undefined> {
    const account = this.#accountProviders().get(providerId)
    if (account === undefined) return undefined
    return this.#describeAccount(providerId, account)
  }

  async listFlowsPublic(): Promise<SafeAuthorizationFlowDto[]> {
    const result: SafeAuthorizationFlowDto[] = []
    for (const [providerId, account] of this.#accountProviders()) {
      result.push(await this.#describeAccount(providerId, account))
    }
    return result
  }
}

export function createAuthorizationRpcHandler(controller: AuthorizationHostController): ConnectionRpcHandler {
  return async (endpoint: string, payload: unknown, _signal: AbortSignal): Promise<ConnectionRpcResult> => {
    try {
      switch (endpoint) {
        case AUTH_GET_FLOWS_ENDPOINT:
          if (!isPlainObject(payload) || Object.keys(payload).length !== 0) return createBadRequestResult()
          return { ok: true, value: await controller.listFlowsPublic() }
        case AUTH_GET_STATUS_ENDPOINT: {
          if (!isPlainObject(payload) || Object.keys(payload).length !== 1) return createBadRequestResult()
          const rawId = payload.providerId
          if (!isWellFormedProviderId(rawId)) return createBadRequestResult()
          const dto = await controller.describeProviderPublic(rawId)
          if (dto === undefined) return createBadRequestResult()
          return { ok: true, value: dto }
        }
        case AUTH_REFRESH_ENDPOINT: {
          if (!isPlainObject(payload)) return createBadRequestResult()
          const keys = Object.keys(payload)
          if (keys.length === 0) return { ok: true, value: await controller.listFlowsPublic() }
          if (keys.length !== 1 || keys[0] !== 'providerId') return createBadRequestResult()
          const rawId = payload.providerId
          if (!isWellFormedProviderId(rawId)) return createBadRequestResult()
          const dto = await controller.describeProviderPublic(rawId)
          if (dto === undefined) return createBadRequestResult()
          return { ok: true, value: dto }
        }
        default:
          // Also covers the removed mutating endpoints (begin-login,
          // submit-prompt, cancel-login, logout): no DSH-managed subscription
          // login or atomic legacy-grant deletion exists to dispatch to, so
          // an old client sending one of those endpoint names gets the same
          // generic bad-request as any other unrecognized endpoint.
          return createBadRequestResult()
      }
    } catch {
      return createInternalErrorResult()
    }
  }
}
