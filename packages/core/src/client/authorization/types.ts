/** Safe Browser DTO and state definitions for Model Accounts. */

export type AuthorizationUiState =
  | 'NOT_CONFIGURED'
  | 'CONNECTED'
  | 'ERROR'

export interface SafeAuthorizationFlowDto {
  providerId: string
  label: string
  configured: boolean
  credentialKind?: 'api-key' | 'grant'
  status: AuthorizationUiState
  lastError?: string
}

export interface AuthorizationControllerSnapshot {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  flows: Record<string, SafeAuthorizationFlowDto>
  lastRefreshedAtMs?: number
  globalError?: string
}
