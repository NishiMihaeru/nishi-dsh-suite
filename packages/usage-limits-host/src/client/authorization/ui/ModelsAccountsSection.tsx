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

export const ORDERED_PROVIDERS = ['openai-codex', 'anthropic', 'openai'] as const

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

      <div className={styles.cardsList}>
        {ORDERED_PROVIDERS.map((providerId) => {
          const flow = snapshot.flows[providerId]
          if (!flow) return null
          return (
            <ModelsSignInCard
              key={providerId}
              flow={flow}
              controller={controller}
              t={t}
            />
          )
        })}
      </div>
    </div>
  )
}
