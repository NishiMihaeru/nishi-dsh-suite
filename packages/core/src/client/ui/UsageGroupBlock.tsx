import React from 'react'
import type { UsageGroup } from '../usage-group-model.js'
import {
  selectUsageGroupDisplayWindows,
  usageWindowDisplayLabel,
} from '../usage-group-model.js'
import { formatPercent, type UsageLimitsLocaleKey } from '../view-model.js'
import { ProviderLogo, usageGroupAccent } from './ProviderLogo.js'
import { UsageBars, formatResetCountdown } from './UsageBars.js'
import styles from './UsageGroupBlock.module.css'

export interface UsageGroupBlockProps {
  group: UsageGroup
  nowMs: number
  compact?: boolean
  selected?: boolean
  onClick?: () => void
  t: (key: UsageLimitsLocaleKey) => string
}

function titleFor(group: UsageGroup): string {
  if (group.kind === 'POOL' && group.parentDisplayName) {
    return `${group.parentDisplayName} · ${group.displayName}`
  }
  return group.displayName
}

function statusText(group: UsageGroup, t: UsageGroupBlockProps['t']): string | undefined {
  switch (group.status) {
    case 'LOADING': return t('loadingUsage')
    case 'UNSUPPORTED': return t('statusUnsupported')
    case 'LOGIN_REQUIRED': return t('statusLoginRequired')
    case 'UNAVAILABLE': return t('statusUnavailable')
    case 'ERROR': return t('statusError')
    default: return undefined
  }
}

function compactAriaLabel(group: UsageGroup, t: UsageGroupBlockProps['t']): string {
  const parts = [titleFor(group)]
  const status = statusText(group, t)
  if (status) {
    parts.push(status)
    return parts.join(', ')
  }

  for (const win of selectUsageGroupDisplayWindows(group.windows)) {
    const label = usageWindowDisplayLabel(win)
    parts.push(`${label}: ${formatPercent(win.usedPercent)} used, ${formatPercent(win.remainingPercent)} remaining`)
  }
  return parts.join(', ')
}

export function UsageGroupBlock(props: UsageGroupBlockProps): React.ReactElement {
  const { group, nowMs, compact = false, selected = false, onClick, t } = props
  const displayWindows = selectUsageGroupDisplayWindows(group.windows)
  const status = statusText(group, t)
  const resets = displayWindows.flatMap((win) => {
    const value = formatResetCountdown(win.resetsAtMs, nowMs)
    return value ? [{ win, value }] : []
  })
  const accentStyle = { '--usage-accent': usageGroupAccent(group) } as React.CSSProperties

  return (
    <button
      type="button"
      className={`${styles.block} ${compact ? styles.compactBlock : ''} ${selected ? styles.selected : ''}`}
      style={accentStyle}
      onClick={onClick}
      aria-label={compact ? compactAriaLabel(group, t) : titleFor(group)}
    >
      <div className={`${styles.header} ${compact ? styles.compactHeader : ''}`}>
        <span className={styles.icon} aria-hidden="true">
          <ProviderLogo presentation={group.presentation} className={styles.logo} />
        </span>
        {!compact && (
          <span className={styles.titleWrap}>
            <span className={styles.title}>{titleFor(group)}</span>
            {group.refreshing && <span className={styles.refreshing}>{t('refreshing')}</span>}
            {group.loadError && <span className={styles.errorHint}>{t('badgeError')}</span>}
          </span>
        )}
      </div>

      {group.status === 'AVAILABLE' && displayWindows.length > 0 ? (
        <UsageBars
          windows={displayWindows}
          nowMs={nowMs}
          compact={compact}
          ariaPrefix={titleFor(group)}
          className={compact ? styles.compactBars : styles.bars}
        />
      ) : compact ? (
        <span className={styles.compactUnavailable} aria-hidden="true">—</span>
      ) : (
        <span className={`${styles.status} ${group.status === 'ERROR' ? styles.statusError : ''}`}>
          {status ?? t('noLimits')}
        </span>
      )}

      {!compact && group.status === 'AVAILABLE' && resets.length > 0 && (
        <div className={styles.resetSection}>
          <span className={styles.resetTitle}>{t('resetLabel')}</span>
          <div className={styles.resetList}>
            {resets.map(({ win, value }) => (
              <span key={win.id} className={styles.resetItem}>
                <span className={styles.resetWindow}>{usageWindowDisplayLabel(win)}</span>
                <span className={styles.resetCountdown}>{value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </button>
  )
}
