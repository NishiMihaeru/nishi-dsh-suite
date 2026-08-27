export const CLAUDE_PROVIDER_ID = 'claude'
export const CODEX_PROVIDER_ID = 'codex'
export const ANTIGRAVITY_PROVIDER_ID = 'antigravity'

export interface ProviderRosterItem {
  id: string
  defaultDisplayName: string
}

export const PRODUCT_PROVIDER_ROSTER: readonly ProviderRosterItem[] = Object.freeze([
  { id: CLAUDE_PROVIDER_ID, defaultDisplayName: 'Claude' },
  { id: CODEX_PROVIDER_ID, defaultDisplayName: 'Codex' },
  { id: ANTIGRAVITY_PROVIDER_ID, defaultDisplayName: 'Antigravity' },
])
