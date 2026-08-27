/** Safe Browser DTO and state definitions for Models Sign-In and Authorization. */

export type AuthorizationUiState =
  | 'NOT_CONFIGURED'
  | 'SIGN_IN_AVAILABLE'
  | 'AUTHORIZING'
  | 'WAITING_FOR_USER'
  | 'CONNECTED'
  | 'ERROR'

export interface SafeAuthorizationNoticeDto {
  message: string
  url?: string
  code?: string
}

export interface SafeAuthorizationPromptOptionDto {
  id: string
  label: string
  description?: string
}

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

export interface AuthorizationControllerSnapshot {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  flows: Record<string, SafeAuthorizationFlowDto>
  lastRefreshedAtMs?: number
  globalError?: string
}
