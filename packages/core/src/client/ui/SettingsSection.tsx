import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconRefreshOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageLimitsClientInjected } from '../index.js'
import { buildUsageGroupsForProvider } from '../usage-group-model.js'
import { UsageGroupDetails } from './UsageGroupDetails.js'
import styles from './SettingsSection.module.css'

export type SettingsSectionProps = PropsRuntime<'settings.section'> &
  InjectFace<UsageLimitsClientInjected>

export function UsageLimitsSection(props: SettingsSectionProps): React.ReactElement {
  const { controller, useSnapshot, t } = props
  const snapshot = useSnapshot((s) => s)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    setNowMs(Date.now())
    controller.ensureAllFresh().catch(() => {})
  }, [controller])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const groups = useMemo(() => snapshot.roster.flatMap((item) => {
    const entry = snapshot.providers[item.providerId]
    return buildUsageGroupsForProvider({
      presentation: item.presentation,
      loadStatus: entry?.status ?? 'idle',
      usage: entry?.usage,
    })
  }), [snapshot])

  const isAnyRefreshing = snapshot.roster.some(
    (item) => snapshot.providers[item.providerId]?.status === 'loading',
  )

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={isAnyRefreshing}
          icon={<IconRefreshOutline14 size={14} />}
          onClick={() => {
            setNowMs(Date.now())
            controller.refreshAll().catch(() => {})
          }}
        >
          {isAnyRefreshing ? t('refreshing') : t('refreshAll')}
        </Button>
      </div>

      <div className={styles.providerCardsList}>
        {groups.map((group) => {
          const entry = snapshot.providers[group.providerId]
          const isRefreshing = entry?.status === 'loading'
          const displayName = group.kind === 'POOL' && group.parentDisplayName
            ? `${group.parentDisplayName} · ${group.displayName}`
            : group.displayName

          return (
            <div key={`${group.providerId}:${group.id}`} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.headerLeft}>
                  <span className={styles.providerName}>{displayName}</span>
                  {group.kind === 'POOL' && (
                    <span className={styles.badgeOther}>{t('poolLabel')}</span>
                  )}
                  {group.freshness === 'STALE' && (
                    <span className={styles.freshnessTagStale}>{t('stale')}</span>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isRefreshing}
                  icon={<IconRefreshOutline14 size={14} />}
                  onClick={() => {
                    setNowMs(Date.now())
                    controller.refreshProvider(group.providerId).catch(() => {})
                  }}
                >
                  {isRefreshing ? t('refreshing') : t('refresh')}
                </Button>
              </div>

              <UsageGroupDetails group={group} nowMs={nowMs} t={t} showHeader={false} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
