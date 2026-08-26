import React from 'react'
import type { PublicLimitWindow } from 'nishi-dsh-usage-limits'
import { usageWindowDisplayLabel } from '../usage-group-model.js'
import { formatPercent } from '../view-model.js'
import styles from './UsageBars.module.css'

export interface UsageBarsProps {
  windows: PublicLimitWindow[]
  nowMs: number
  compact?: boolean
  ariaPrefix?: string
  className?: string
}

export function formatResetCountdown(resetsAtMs: number | undefined, nowMs: number): string | undefined {
  if (resetsAtMs === undefined || !Number.isFinite(resetsAtMs)) return undefined
  const delta = Math.max(0, resetsAtMs - nowMs)
  if (delta <= 0) return 'now'
  const totalMinutes = Math.max(1, Math.ceil(delta / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function UsageBars(props: UsageBarsProps): React.ReactElement | null {
  const { windows, nowMs, compact = false, ariaPrefix, className } = props
  void nowMs
  if (windows.length === 0) return null
  return (
    <div className={`${styles.list} ${compact ? styles.compactList : ''} ${className ?? ''}`}>
      {windows.map((win) => {
        const used = Math.min(100, Math.max(0, win.usedPercent))
        const label = usageWindowDisplayLabel(win)
        return (
          <div key={win.id} className={`${styles.row} ${compact ? styles.compactRow : ''}`}>
            {!compact && <span className={styles.label}>{label}</span>}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={used}
              aria-label={`${ariaPrefix ? `${ariaPrefix} ` : ''}${label}: ${formatPercent(win.usedPercent)} used`}
              className={`${styles.track} ${compact ? styles.compactTrack : ''}`}
            >
              <div className={styles.fill} style={{ width: `${used}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
