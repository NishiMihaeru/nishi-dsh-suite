import React from 'react'
import type { UsageGroup } from '../usage-group-model.js'
import {
  sortUsageGroupWindows,
  usageWindowDisplayLabel,
} from '../usage-group-model.js'
import { formatExtraUsage, formatPercent, type UsageLimitsLocaleKey } from '../view-model.js'
import { usageGroupAccent } from './ProviderLogo.js'
import { UsageBars, formatResetCountdown } from './UsageBars.js'
import styles from './UsageGroupDetails.module.css'

export interface UsageGroupDetailsProps {
  group: UsageGroup
  nowMs: number
  t: (key: UsageLimitsLocaleKey) => string
  showHeader?: boolean
}

function groupTitle(group: UsageGroup): string {
  return group.kind === 'POOL' && group.parentDisplayName
    ? `${group.parentDisplayName} · ${group.displayName}`
    : group.displayName
}

function statusText(group: UsageGroup, t: UsageGroupDetailsProps['t']): string | undefined {
  switch (group.status) {
    case 'LOADING': return t('loadingUsage')
    case 'UNSUPPORTED': return t('statusUnsupported')
    case 'LOGIN_REQUIRED': return t('statusLoginRequired')
    case 'UNAVAILABLE': return t('statusUnavailable')
    case 'ERROR': return t('statusError')
    default: return undefined
  }
}

export function UsageGroupDetails(props: UsageGroupDetailsProps): React.ReactElement {
  const { group, nowMs, t, showHeader = true } = props
  const windows = sortUsageGroupWindows(group.windows)
  const status = statusText(group, t)
  const resetRows = windows.flatMap((win) => {
    const value = formatResetCountdown(win.resetsAtMs, nowMs)
    return value ? [{ win, value }] : []
  })
  const accentStyle = { '--usage-accent': usageGroupAccent(group) } as React.CSSProperties

  return (
    <div className={styles.container} style={accentStyle}>
      {showHeader && (
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <span className={styles.title}>{groupTitle(group)}</span>
            {group.kind === 'POOL' && <span className={styles.kind}>{t('poolLabel')}</span>}
          </div>
          {group.refreshing && <span className={styles.refreshing}>{t('refreshing')}</span>}
        </div>
      )}

      {group.loadError && group.status === 'AVAILABLE' && (
        <div className={styles.errorNotice}>{t('statusError')}</div>
      )}

      {group.status === 'AVAILABLE' ? (
        windows.length > 0 ? (
          <>
            <UsageBars windows={windows} nowMs={nowMs} ariaPrefix={groupTitle(group)} />
            <div className={styles.metricsList}>
              {windows.map((win) => (
                <div key={win.id} className={styles.metricsRow}>
                  <span className={styles.metricLabel}>{usageWindowDisplayLabel(win)}</span>
                  <span>{t('used')}: {formatPercent(win.usedPercent)}</span>
                  <span>{t('remaining')}: {formatPercent(win.remainingPercent)}</span>
                </div>
              ))}
            </div>

            {resetRows.length > 0 && (
              <div className={styles.resetSection}>
                <span className={styles.resetTitle}>{t('resetLabel')}</span>
                <div className={styles.resetList}>
                  {resetRows.map(({ win, value }) => (
                    <span key={win.id} className={styles.resetRow}>
                      <span className={styles.metricLabel}>{usageWindowDisplayLabel(win)}</span>
                      <span>{value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {group.extraUsage && (
              <div className={styles.extraUsage}>
                <span className={styles.extraTitle}>{t('extraUsage')}</span>
                {(() => {
                  const formatted = formatExtraUsage(group.extraUsage)
                  return (
                    <div className={styles.extraGrid}>
                      {formatted.used && <span>{t('used')}: {formatted.used}</span>}
                      {formatted.limit && <span>{t('limitLabel')}: {formatted.limit}</span>}
                      {formatted.remaining && <span>{t('remaining')}: {formatted.remaining}</span>}
                    </div>
                  )
                })()}
              </div>
            )}
          </>
        ) : (
          <p className={styles.status}>{t('noLimits')}</p>
        )
      ) : (
        <p className={`${styles.status} ${group.status === 'ERROR' ? styles.statusError : ''}`}>
          {status}
        </p>
      )}
    </div>
  )
}
