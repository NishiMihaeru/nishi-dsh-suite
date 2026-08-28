/**
 * Cordis Connection RPC handler for the Model Accounts status surface.
 * Subscription OAuth is intentionally not initiated by DSH. This bridge only
 * reports legacy DSH grants so users can remove them safely; token material is
 * never projected to the browser.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

export const AUTHORIZATION_RPC_CHANNEL = '/authorization'
export const AUTH_GET_FLOWS_ENDPOINT = 'list-flows'
export const AUTH_GET_STATUS_ENDPOINT = 'get-provider-status'
export const AUTH_BEGIN_LOGIN_ENDPOINT = 'begin-login'
export const AUTH_SUBMIT_PROMPT_ENDPOINT = 'submit-prompt'
export const AUTH_CANCEL_LOGIN_ENDPOINT = 'cancel-login'
export const AUTH_LOGOUT_ENDPOINT = 'logout'
export const AUTH_REFRESH_ENDPOINT = 'refresh'

export type AuthorizationUiState = 'NOT_CONFIGURED' | 'SIGN_IN_AVAILABLE' | 'AUTHORIZING' | 'WAITING_FOR_USER' | 'CONNECTED' | 'ERROR'
export interface SafeAuthorizationNoticeDto { message: string; url?: string; code?: string }
export interface SafeAuthorizationPromptOptionDto { id: string; label: string; description?: string }
export interface SafeAuthorizationPromptDto {
  kind: 'text' | 'secret' | 'select'
  message: string
  placeholder?: string
  options?: SafeAuthorizationPromptOptionDto[]
}
export interface SafeAuthorizationFlowDto {
  providerId: string
  flowKey: string
  label: string
  methods: Array<{ id: string; label: string }>
  inFlight: boolean
  configured: boolean
  credentialKind?: 'api-key' | 'grant'
  status: AuthorizationUiState
  lastNotice?: SafeAuthorizationNoticeDto
  lastPrompt?: SafeAuthorizationPromptDto
  lastError?: string
}
export interface BeginLoginRpcRequest { providerId: string; method?: string }
export interface SubmitPromptRpcRequest { providerId: string; value: string }
export interface CancelLoginRpcRequest { providerId: string }
export interface LogoutRpcRequest { providerId: string }
export interface RefreshRpcRequest { providerId?: string }

type ConnectionRpcResult = Awaited<ReturnType<ConnectionRpcHandler>>
type ConnectionRpcError = Extract<ConnectionRpcResult, { ok: false }>['error']

const GENERIC_BAD_REQUEST_MESSAGE = 'Invalid authorization request.'
const GENERIC_INTERNAL_ERROR_MESSAGE = 'Authorization operation failed.'
const GENERIC_STATE_UNAVAILABLE_MESSAGE = 'Authorization state is unavailable.'
const MAX_PROVIDER_ID_LENGTH = 64

export const READ_PROVIDER_IDS = new Set(['openai-codex', 'anthropic', 'openai'])
/** No provider is allowed to start subscription OAuth through DSH. */
export const MUTATING_PROVIDER_IDS = new Set<string>()
/** Legacy grants remain removable without exposing or reusing their token material. */
export const LEGACY_LOGOUT_PROVIDER_IDS = new Set(['openai-codex', 'anthropic'])

const PROVIDER_LABELS: Record<string, string> = {
  'openai-codex': 'ChatGPT / Codex',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
}

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
function validProviderId(value: unknown, allowed: Set<string>): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && value.length <= MAX_PROVIDER_ID_LENGTH && allowed.has(trimmed)
}

export class AuthorizationHostController {
  constructor(private readonly ctx: Context) {}

  async describeProviderPublic(providerId: string): Promise<SafeAuthorizationFlowDto> {
    if (!READ_PROVIDER_IDS.has(providerId)) throw new Error(`Unsupported provider "${providerId}".`)
    const key = credentialKey('llm-pi-ai', providerId)
    if (providerId === 'openai') {
      return {
        providerId,
        flowKey: key,
        label: PROVIDER_LABELS[providerId] ?? providerId,
        methods: [],
        inFlight: false,
        configured: false,
        status: 'NOT_CONFIGURED',
      }
    }

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
      flowKey: key,
      label: PROVIDER_LABELS[providerId] ?? providerId,
      methods: [],
      inFlight: false,
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

  async listFlowsPublic(): Promise<SafeAuthorizationFlowDto[]> {
    const result: SafeAuthorizationFlowDto[] = []
    for (const providerId of READ_PROVIDER_IDS) result.push(await this.describeProviderPublic(providerId))
    return result
  }

  async beginLogin(providerId: string, _method?: string): Promise<SafeAuthorizationFlowDto> {
    throw new Error(`Direct subscription login is disabled for provider "${providerId}".`)
  }
  async submitPrompt(providerId: string, _value: string): Promise<SafeAuthorizationFlowDto> {
    throw new Error(`Direct subscription login is disabled for provider "${providerId}".`)
  }
  async cancelLogin(providerId: string): Promise<SafeAuthorizationFlowDto> {
    throw new Error(`No DSH-managed subscription login exists for provider "${providerId}".`)
  }

  async logout(providerId: string): Promise<SafeAuthorizationFlowDto> {
    if (!LEGACY_LOGOUT_PROVIDER_IDS.has(providerId)) throw new Error(`Unsupported provider "${providerId}" for legacy grant removal.`)
    const key = credentialKey('llm-pi-ai', providerId)
    if (this.ctx.credentials) {
      const desc = await this.ctx.credentials.describeRecord(key)
      if (desc?.kind === 'grant') await this.ctx.credentials.deleteRecord(key)
    }
    return this.describeProviderPublic(providerId)
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
          if (!validProviderId(rawId, READ_PROVIDER_IDS)) return createBadRequestResult()
          return { ok: true, value: await controller.describeProviderPublic(rawId.trim()) }
        }
        case AUTH_BEGIN_LOGIN_ENDPOINT:
        case AUTH_SUBMIT_PROMPT_ENDPOINT:
        case AUTH_CANCEL_LOGIN_ENDPOINT:
          return createBadRequestResult()
        case AUTH_LOGOUT_ENDPOINT: {
          if (!isPlainObject(payload) || Object.keys(payload).length !== 1) return createBadRequestResult()
          const rawId = payload.providerId
          if (!validProviderId(rawId, LEGACY_LOGOUT_PROVIDER_IDS)) return createBadRequestResult()
          return { ok: true, value: await controller.logout(rawId.trim()) }
        }
        case AUTH_REFRESH_ENDPOINT: {
          if (!isPlainObject(payload)) return createBadRequestResult()
          const keys = Object.keys(payload)
          if (keys.length === 0) return { ok: true, value: await controller.listFlowsPublic() }
          if (keys.length !== 1 || keys[0] !== 'providerId') return createBadRequestResult()
          const rawId = payload.providerId
          if (!validProviderId(rawId, READ_PROVIDER_IDS)) return createBadRequestResult()
          return { ok: true, value: await controller.describeProviderPublic(rawId.trim()) }
        }
        default:
          return createBadRequestResult()
      }
    } catch {
      return createInternalErrorResult()
    }
  }
}
