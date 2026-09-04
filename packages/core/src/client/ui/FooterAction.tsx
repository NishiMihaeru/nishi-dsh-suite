import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageLimitsClientInjected } from '../index.js'
import {
  createBrowserUsageAutoRefreshScheduler,
  startUsageAutoRefresh,
} from '../auto-refresh.js'
import {
  buildUsageGroupsForProvider,
  selectUsageGroupDisplayWindows,
  usageWindowDisplayLabel,
  type UsageGroup,
} from '../usage-group-model.js'
import { formatPercent, resolveSidebarProviders } from '../view-model.js'
import { UsageGroupBlock } from './UsageGroupBlock.js'
import { UsageGroupDetails } from './UsageGroupDetails.js'
import styles from './FooterAction.module.css'

export type FooterActionProps = PropsRuntime<'sidebar.footer.action'> &
  InjectFace<UsageLimitsClientInjected>

interface PopoverCoords {
  left: number
  bottom: number
}

interface UsageHoverState {
  group: UsageGroup
  left: number
  top: number
}

interface ResizeState {
  pointerId: number
  startY: number
  startHeight: number
  currentHeight: number
}

const MIN_USAGE_HEIGHT = 230
const DEFAULT_USAGE_HEIGHT = 300
const MAX_USAGE_HEIGHT = 480

function groupKey(group: UsageGroup): string {
  return `${group.providerId}:${group.id}`
}

function groupTitle(group: UsageGroup): string {
  if (group.kind === 'POOL' && group.parentDisplayName) {
    return `${group.parentDisplayName} · ${group.displayName}`
  }
  return group.displayName
}

function clampUsageHeight(height: number): number {
  const viewportMax = typeof window === 'undefined'
    ? MAX_USAGE_HEIGHT
    : Math.max(MIN_USAGE_HEIGHT, Math.min(MAX_USAGE_HEIGHT, window.innerHeight - 150))
  return Math.max(MIN_USAGE_HEIGHT, Math.min(viewportMax, Math.round(height)))
}

export function UsageLimitsFooterAction(props: FooterActionProps): React.ReactElement {
  const { wide, controller, useSnapshot, t } = props
  const snapshot = useSnapshot((s) => s)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fitViewportRef = useRef<HTMLDivElement>(null)
  const fitContentRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [coords, setCoords] = useState<PopoverCoords | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [usageHeight, setUsageHeight] = useState(() =>
    clampUsageHeight(snapshot.sidebarSettings?.panelHeight ?? DEFAULT_USAGE_HEIGHT),
  )
  const [contentScale, setContentScale] = useState(1)
  const [hover, setHover] = useState<UsageHoverState | null>(null)

  const groups = useMemo(() => {
    const allGroups = snapshot.roster.flatMap((item) => {
      const entry = snapshot.providers[item.providerId]
      return buildUsageGroupsForProvider({
        presentation: item.presentation,
        loadStatus: entry?.status ?? 'idle',
        usage: entry?.usage,
      })
    })
    return resolveSidebarProviders(allGroups, snapshot.sidebarSettings)
  }, [snapshot.roster, snapshot.providers, snapshot.sidebarSettings])

  const selectedGroup = selectedKey
    ? groups.find((group) => groupKey(group) === selectedKey)
    : undefined

  const isAnyRefreshing = snapshot.roster.some(
    (item) => snapshot.providers[item.providerId]?.status === 'loading',
  )

  const wideStyle = {
    '--usage-panel-height': `${usageHeight}px`,
  } as React.CSSProperties

  const fitContentStyle = {
    width: `${100 / contentScale}%`,
    transform: `scale(${contentScale})`,
  } as React.CSSProperties

  const recomputeFitScale = useCallback(() => {
    const viewport = fitViewportRef.current
    const content = fitContentRef.current
    if (!viewport || !content) return

    const availableHeight = viewport.clientHeight
    const naturalHeight = content.scrollHeight
    if (availableHeight <= 0 || naturalHeight <= 0) return

    const nextScale = Math.min(1, availableHeight / naturalHeight)
    setContentScale((current) => Math.abs(current - nextScale) > 0.002 ? nextScale : current)
  }, [])

  useLayoutEffect(() => {
    if (!wide) {
      setContentScale(1)
      return
    }

    recomputeFitScale()
    const viewport = fitViewportRef.current
    const content = fitContentRef.current
    if (!viewport || !content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => recomputeFitScale())
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [wide, groups, usageHeight, recomputeFitScale])

  useEffect(() => {
    controller.ensureAllFresh().catch(() => {})
  }, [controller])

  useEffect(() => startUsageAutoRefresh(
    () => controller.refreshAll(),
    createBrowserUsageAutoRefreshScheduler(),
  ), [controller])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedKey && !selectedGroup) {
      setSelectedKey(null)
      setCoords(null)
    }
  }, [selectedGroup, selectedKey])

  useEffect(() => {
    setUsageHeight(clampUsageHeight(snapshot.sidebarSettings?.panelHeight ?? DEFAULT_USAGE_HEIGHT))
  }, [snapshot.sidebarSettings?.panelHeight])

  useEffect(() => {
    const onResize = () => setUsageHeight((current) => clampUsageHeight(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const updateCoords = useCallback(() => {
    const node = containerRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const panelWidth = 340
    const left = Math.min(
      Math.max(8, rect.right + 8),
      Math.max(8, window.innerWidth - panelWidth - 8),
    )
    const bottom = Math.max(8, window.innerHeight - rect.bottom)
    setCoords({ left, bottom })
  }, [])

  useEffect(() => {
    if (!selectedGroup) return

    updateCoords()
    const onResize = () => updateCoords()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedKey(null)
        setCoords(null)
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setSelectedKey(null)
        setCoords(null)
      }
    }

    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [selectedGroup, updateCoords])

  const selectGroup = (group: UsageGroup) => {
    setNowMs(Date.now())
    const key = groupKey(group)
    setSelectedKey((current) => current === key ? null : key)
    updateCoords()
  }

  const showHover = (group: UsageGroup, rect: DOMRect) => {
    const windows = selectUsageGroupDisplayWindows(group.windows)
    if (group.status !== 'AVAILABLE' || windows.length === 0) {
      setHover(null)
      return
    }

    const tooltipWidth = 224
    const estimatedHeight = 42 + windows.length * 28
    let left = rect.right + 10
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.left - tooltipWidth - 10)
    }
    const top = Math.max(
      8,
      Math.min(rect.top, Math.max(8, window.innerHeight - estimatedHeight - 8)),
    )
    setHover({ group, left, top })
  }

  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    setHover(null)
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: usageHeight,
      currentHeight: usageHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const nextHeight = clampUsageHeight(resize.startHeight + (resize.startY - event.clientY))
    resize.currentHeight = nextHeight
    setUsageHeight(nextHeight)
  }

  const onResizePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    resizeRef.current = null
    controller.setPanelHeight(resize.currentHeight)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const renderHoverTarget = (group: UsageGroup, compact = false) => (
    <div
      key={groupKey(group)}
      className={styles.groupHoverTarget}
      onPointerEnter={(event) => showHover(group, event.currentTarget.getBoundingClientRect())}
      onPointerLeave={() => setHover(null)}
    >
      <UsageGroupBlock
        group={group}
        nowMs={nowMs}
        t={t}
        compact={compact}
        selected={selectedKey === groupKey(group)}
        onClick={() => selectGroup(group)}
      />
    </div>
  )

  return (
    <div ref={containerRef} className={styles.container}>
      {wide ? (
        <div className={styles.wideShell} style={wideStyle}>
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize usage panel"
            aria-valuemin={MIN_USAGE_HEIGHT}
            aria-valuemax={MAX_USAGE_HEIGHT}
            aria-valuenow={usageHeight}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerEnd}
            onPointerCancel={onResizePointerEnd}
          />

          <div ref={fitViewportRef} className={styles.fitViewport}>
            <div ref={fitContentRef} className={styles.fitContent} style={fitContentStyle}>
              <div className={styles.headerRow}>
                <span className={styles.headerTitle}>{t('trigger')}</span>
                <button
                  type="button"
                  className={styles.refreshButton}
                  disabled={isAnyRefreshing}
                  aria-label={t('refreshAll')}
                  title={isAnyRefreshing ? t('refreshing') : t('refreshAll')}
                  onClick={() => {
                    setNowMs(Date.now())
                    controller.refreshAll().catch(() => {})
                  }}
                >
                  <IconRefreshOutline14 size={14} />
                </button>
              </div>

              <div className={styles.groupList}>
                {groups.map((group) => renderHoverTarget(group))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.compactShell}>
          {groups.map((group) => renderHoverTarget(group, true))}
          <button
            type="button"
            className={styles.compactRefreshButton}
            disabled={isAnyRefreshing}
            aria-label={t('refreshAll')}
            title={isAnyRefreshing ? t('refreshing') : t('refreshAll')}
            onClick={() => {
              setNowMs(Date.now())
              controller.refreshAll().catch(() => {})
            }}
          >
            <IconRefreshOutline14 size={13} />
          </button>
        </div>
      )}

      {hover && (
        <div
          className={styles.usageTooltip}
          style={{ left: `${hover.left}px`, top: `${hover.top}px` }}
          role="tooltip"
        >
          <div className={styles.usageTooltipTitle}>{groupTitle(hover.group)}</div>
          <div className={styles.usageTooltipRows}>
            {selectUsageGroupDisplayWindows(hover.group.windows).map((win) => (
              <div key={win.id} className={styles.usageTooltipRow}>
                <span className={styles.usageTooltipWindow}>{usageWindowDisplayLabel(win)}</span>
                <span>{t('used')} {formatPercent(win.usedPercent)}</span>
                <span>{t('remaining')} {formatPercent(win.remainingPercent)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedGroup && coords && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={`${t('title')}: ${selectedGroup.displayName}`}
          className={styles.popoverPanel}
          style={{ left: `${coords.left}px`, bottom: `${coords.bottom}px` }}
        >
          <UsageGroupDetails group={selectedGroup} nowMs={nowMs} t={t} />
          <button
            type="button"
            className={styles.detailRefreshButton}
            disabled={snapshot.providers[selectedGroup.providerId]?.status === 'loading'}
            onClick={() => {
              setNowMs(Date.now())
              controller.refreshProvider(selectedGroup.providerId).catch(() => {})
            }}
          >
            <IconRefreshOutline14 size={13} />
            <span>{snapshot.providers[selectedGroup.providerId]?.status === 'loading' ? t('refreshing') : t('refresh')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
