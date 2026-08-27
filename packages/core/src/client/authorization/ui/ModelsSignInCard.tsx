import React, { useState, type ReactNode } from 'react'
import type { AuthorizationClientController } from '../controller.js'
import type { SafeAuthorizationFlowDto } from '../types.js'
import { en } from '../locales.js'
import styles from './ModelsSignInCard.module.css'

export interface ModelsSignInCardProps {
  flow: SafeAuthorizationFlowDto
  controller: AuthorizationClientController
  t?: (key: keyof typeof en) => string
}

export function ModelsSignInCard({
  flow,
  controller,
  t = (key) => en[key] || key,
}: ModelsSignInCardProps): ReactNode {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isCodexCliManaged = flow.providerId === 'openai-codex'
  const isClaudeDeferred = flow.providerId === 'anthropic'
  const isOpenAiApiKeyOnly = flow.providerId === 'openai'
  const hasLegacyGrant = flow.credentialKind === 'grant'

  const handleLegacyLogout = async () => {
    setIsSubmitting(true)
    try {
      await controller.logout(flow.providerId)
    } catch {
      // Controller owns the visible error state.
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRefresh = async () => {
    setIsSubmitting(true)
    try {
      await controller.refreshProvider(flow.providerId)
    } catch {
      // Controller owns the visible error state.
    } finally {
      setIsSubmitting(false)
    }
  }

  const badge = (() => {
    if (hasLegacyGrant) {
      return <span className={`${styles.badge} ${styles.badgeWaiting}`}>{t('legacyGrant')}</span>
    }
    if (isCodexCliManaged) {
      return <span className={`${styles.badge} ${styles.badgeConnected}`}>{t('codexCliManaged')}</span>
    }
    if (isClaudeDeferred) {
      return <span className={`${styles.badge} ${styles.badgeNotConfigured}`}>{t('claudePrimaryDeferred')}</span>
    }
    return <span className={`${styles.badge} ${styles.badgeNotConfigured}`}>{t('apiKeyOnly')}</span>
  })()

  const description = isCodexCliManaged
    ? t('codexCliManagedDesc')
    : isClaudeDeferred
      ? t('claudePrimaryDeferredDesc')
      : t('apiKeyOnlyDesc')

  return (
    <div className={styles.card} data-provider-id={flow.providerId} data-auth-status={flow.status}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <span className={styles.providerName}>{flow.label}</span>
        </div>
        {badge}
      </div>

      <div className={styles.description}>{description}</div>

      {isClaudeDeferred && flow.credentialKind === 'api-key' && (
        <div className={styles.description}>{t('apiKeyConfiguredNotice')}</div>
      )}

      {flow.lastError && (
        <div className={styles.errorBanner}>{flow.lastError}</div>
      )}

      {hasLegacyGrant && (
        <div className={styles.instructionBox}>
          <div className={styles.description}>{t('legacyGrantNotice')}</div>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={handleLegacyLogout}
              disabled={isSubmitting}
            >
              {t('signOut')}
            </button>
          </div>
        </div>
      )}

      {(isCodexCliManaged || isClaudeDeferred || isOpenAiApiKeyOnly) && (
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleRefresh}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('refreshing') : t('refresh')}
          </button>
        </div>
      )}
    </div>
  )
}
