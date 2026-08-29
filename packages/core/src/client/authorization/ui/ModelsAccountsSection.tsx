import React, { useEffect, useState } from 'react'
import {
  Button,
  IconRefreshOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelAccountsInjected } from '../../index.js'
import { ModelsSignInCard } from './ModelsSignInCard.js'
import styles from './ModelsAccountsSection.module.css'

export type ModelsAccountsSectionProps = PropsRuntime<'settings.section'> &
  InjectFace<ModelAccountsInjected>

export function ModelsAccountsSection(props: ModelsAccountsSectionProps): React.ReactElement {
  const { controller, useSnapshot, t } = props
  const [isRefreshing, setIsRefreshing] = useState(false)
  const snapshot = useSnapshot((s) => s)

  useEffect(() => {
    if (snapshot.phase === 'idle') controller.load().catch(() => {})
  }, [controller, snapshot.phase])

  const handleRefreshAll = async () => {
    setIsRefreshing(true)
    try {
      await controller.load()
    } catch {
      // Handled in controller state.
    } finally {
      setIsRefreshing(false)
    }
  }

  // The roster is whatever the host reported, in the order it reported it —
  // there is no fixed provider list here to filter against, because a new
  // provider's row is only ever an `account` declaration away.
  const rows = Object.values(snapshot.flows)

  return (
    <div className={styles.container} data-testid="model-accounts-section">
      <div className={styles.topBar}>
        <div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={isRefreshing || snapshot.phase === 'loading'}
          icon={<IconRefreshOutline14 size={14} />}
          onClick={handleRefreshAll}
        >
          {isRefreshing ? t('refreshing') : t('refreshAll')}
        </Button>
      </div>

      {snapshot.globalError && (
        <div className={styles.errorBanner} role="alert">
          {snapshot.globalError}
        </div>
      )}

      {snapshot.phase === 'ready' && rows.length === 0 && (
        <p className={styles.subtitle}>{t('noFlows')}</p>
      )}

      <div className={styles.cardsList}>
        {rows.map((flow) => (
          <ModelsSignInCard
            key={flow.providerId}
            flow={flow}
            controller={controller}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}
