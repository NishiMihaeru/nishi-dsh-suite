import React from 'react'
import styles from './UsageRings.module.css'

export interface UsageRingsProps {
  weeklyPercent?: number
  shortPercent?: number
  size?: number
  ariaLabel?: string
  className?: string
}

function getFillVar(percent: number): string {
  if (percent >= 90) return 'var(--dsw-alias-state-error-primary, currentColor)'
  if (percent >= 75) return 'var(--dsw-alias-state-warn-label, currentColor)'
  return 'var(--dsw-alias-button-primary-fill, currentColor)'
}
function computeConicGradient(usedPercent: number): string {
  const clamped = Math.max(0, Math.min(100, usedPercent))
  const deg = Math.round(clamped * 3.6)
  const fillVar = getFillVar(clamped)
  const trackVar = 'var(--dsw-alias-border-l2, transparent)'
  if (deg <= 0) return `conic-gradient(${trackVar} 0deg 360deg)`
  if (deg >= 360) return `conic-gradient(${fillVar} 0deg 360deg)`
  return `conic-gradient(${fillVar} 0deg ${deg}deg, ${trackVar} ${deg}deg 360deg)`
}

export function UsageRings(props: UsageRingsProps): React.ReactElement | null {
  const { weeklyPercent, shortPercent, size = 20, ariaLabel, className } = props
  const hasWeekly = typeof weeklyPercent === 'number' && !Number.isNaN(weeklyPercent)
  const hasShort = typeof shortPercent === 'number' && !Number.isNaN(shortPercent)
  if (!hasWeekly && !hasShort) return null
  const containerStyle: React.CSSProperties = { width: `${size}px`, height: `${size}px` }
  return (
    <div role="img" aria-label={ariaLabel} className={`${styles.container} ${className ?? ''}`} style={containerStyle}>
      {hasWeekly && hasShort ? (
        <>
          <div className={styles.outerRing} style={{ background: computeConicGradient(weeklyPercent!) }} />
          <div className={styles.innerRing} style={{ background: computeConicGradient(shortPercent!) }} />
        </>
      ) : hasWeekly ? (
        <div className={styles.outerRing} style={{ background: computeConicGradient(weeklyPercent!) }} />
      ) : (
        <div className={styles.innerRing} style={{ background: computeConicGradient(shortPercent!) }} />
      )}
    </div>
  )
}
