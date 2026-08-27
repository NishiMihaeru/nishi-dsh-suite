/** Browser-side RPC Client for Authorization and Models Sign-In. */

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
  beginLogin(providerId: string, method?: string): Promise<SafeAuthorizationFlowDto>
  submitPrompt(providerId: string, value: string): Promise<SafeAuthorizationFlowDto>
  cancelLogin(providerId: string): Promise<SafeAuthorizationFlowDto>
  logout(providerId: string): Promise<SafeAuthorizationFlowDto>
  refresh(providerId?: string): Promise<SafeAuthorizationFlowDto | SafeAuthorizationFlowDto[]>
}

function parseSafeFlowDto(raw: unknown): SafeAuthorizationFlowDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Malformed authorization flow DTO')
  }

  const obj = raw as Record<string, unknown>
  if (typeof obj.providerId !== 'string' || typeof obj.flowKey !== 'string' || typeof obj.status !== 'string') {
    throw new Error('Malformed authorization flow DTO fields')
  }

  const safeMethods: Array<{ id: string; label: string }> = []
  if (Array.isArray(obj.methods)) {
    for (const m of obj.methods) {
      if (m && typeof m === 'object' && typeof (m as any).id === 'string' && typeof (m as any).label === 'string') {
        safeMethods.push({ id: (m as any).id, label: (m as any).label })
      }
    }
  }

  let lastNotice: SafeAuthorizationFlowDto['lastNotice']
  if (obj.lastNotice && typeof obj.lastNotice === 'object' && !Array.isArray(obj.lastNotice)) {
    const n = obj.lastNotice as Record<string, unknown>
    lastNotice = {
      message: String(n.message || ''),
      url: typeof n.url === 'string' ? n.url : undefined,
      code: typeof n.code === 'string' ? n.code : undefined,
    }
  }

  let lastPrompt: SafeAuthorizationFlowDto['lastPrompt']
  if (obj.lastPrompt && typeof obj.lastPrompt === 'object' && !Array.isArray(obj.lastPrompt)) {
    const p = obj.lastPrompt as Record<string, unknown>
    const kind = p.kind === 'secret' || p.kind === 'select' ? p.kind : 'text'
    const options: Array<{ id: string; label: string; description?: string }> = []
    if (Array.isArray(p.options)) {
      for (const opt of p.options) {
        if (opt && typeof opt === 'object' && typeof (opt as any).id === 'string' && typeof (opt as any).label === 'string') {
          options.push({
            id: (opt as any).id,
            label: (opt as any).label,
            description: typeof (opt as any).description === 'string' ? (opt as any).description : undefined,
          })
        }
      }
    }
    lastPrompt = {
      kind,
      message: String(p.message || ''),
      placeholder: typeof p.placeholder === 'string' ? p.placeholder : undefined,
      options: options.length > 0 ? options : undefined,
    }
  }

  const credentialKind: 'api-key' | 'grant' | undefined =
    obj.credentialKind === 'grant' || obj.credentialKind === 'api-key' ? obj.credentialKind : undefined

  const rawStatus = typeof obj.status === 'string' ? obj.status : 'NOT_CONFIGURED'
  const safeStatus: AuthorizationUiState =
    rawStatus === 'CONNECTED' ||
    rawStatus === 'WAITING_FOR_USER' ||
    rawStatus === 'AUTHORIZING' ||
    rawStatus === 'ERROR' ||
    rawStatus === 'SIGN_IN_AVAILABLE'
      ? rawStatus
      : 'NOT_CONFIGURED'

  return {
    providerId: obj.providerId,
    flowKey: obj.flowKey,
    label: typeof obj.label === 'string' ? obj.label : obj.providerId,
    methods: safeMethods,
    inFlight: Boolean(obj.inFlight),
    configured: Boolean(obj.configured),
    credentialKind,
    status: safeStatus,
    lastNotice,
    lastPrompt,
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

  async beginLogin(providerId: string, method?: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'begin-login', { providerId, ...(method ? { method } : {}) })
      if (!res || !res.ok) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
      return parseSafeFlowDto(res.value)
    } catch {
      throw new Error(GENERIC_AUTH_CLIENT_ERROR)
    }
  }

  async submitPrompt(providerId: string, value: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'submit-prompt', { providerId, value })
      if (!res || !res.ok) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
      return parseSafeFlowDto(res.value)
    } catch {
      throw new Error(GENERIC_AUTH_CLIENT_ERROR)
    }
  }

  async cancelLogin(providerId: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'cancel-login', { providerId })
      if (!res || !res.ok) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
      return parseSafeFlowDto(res.value)
    } catch {
      throw new Error(GENERIC_AUTH_CLIENT_ERROR)
    }
  }

  async logout(providerId: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const res = await this.rpc.call(AUTHORIZATION_RPC_CHANNEL, 'logout', { providerId })
      if (!res || !res.ok) throw new Error(GENERIC_AUTH_CLIENT_ERROR)
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
