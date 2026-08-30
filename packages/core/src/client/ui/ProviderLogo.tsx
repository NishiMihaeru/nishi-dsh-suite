import React from 'react'
import { NEUTRAL_BRAND_COLOR, type ProviderPresentation } from '../rpc-client.js'
import type { UsageGroup } from '../usage-group-model.js'

export interface ProviderLogoProps {
  presentation: ProviderPresentation
  className?: string
}

/**
 * Accent colour for one group, taken from what the provider declared. Before
 * rc.3 this was a `switch` over three hardcoded ids, so an unknown provider
 * rendered grey with no mark and a new one needed a browser edit.
 */
export function usageGroupAccent(group: Pick<UsageGroup, 'presentation'>): string {
  const declared = group.presentation?.brandColor
  return typeof declared === 'string' && declared.trim().length > 0 ? declared : NEUTRAL_BRAND_COLOR
}

/**
 * One SVG path in a 24x24 viewBox, supplied by the provider as data — the
 * browser cannot import a provider package, since those spawn processes. A
 * provider that declares no icon gets the neutral mark, which is a supported
 * outcome rather than a visual bug.
 *
 * Filled with the even-odd rule, so a mark whose subpaths overlap can carry a
 * hole where they do. Provider icons must be authored for it; a path with no
 * overlapping subpaths renders identically under either rule.
 */
export function ProviderLogo({ presentation, className }: ProviderLogoProps): React.ReactElement {
  const iconPath = presentation?.iconPath
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {typeof iconPath === 'string' && iconPath.trim().length > 0
        ? <path d={iconPath} fillRule="evenodd" />
        : <circle cx="12" cy="12" r="8" />}
    </svg>
  )
}
