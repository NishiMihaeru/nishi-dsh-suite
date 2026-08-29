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

/**
 * Badge style and copy come entirely from the DTO's generic fields — status
 * and credential kind — never from `providerId`. A provider's identity is
 * data the descriptor supplies (`flow.label`); the card must not special-case
 * a vendor by id, or a new provider would need a browser-side branch again.
 */
const STATUS_BADGE_STYLE: Record<SafeAuthorizationFlowDto['status'], string> = {
  CONNECTED: 'badgeConnected',
  NOT_CONFIGURED: 'badgeNotConfigured',
  ERROR: 'badgeError',
}
const STATUS_LABEL_KEY: Record<SafeAuthorizationFlowDto['status'], keyof typeof en> = {
  CONNECTED: 'statusConnected',
  NOT_CONFIGURED: 'statusNotConfigured',
  ERROR: 'statusError',
}

export function ModelsSignInCard({
  flow,
  controller,
  t = (key) => en[key] || key,
}: ModelsSignInCardProps): ReactNode {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hasLegacyGrant = flow.credentialKind === 'grant'

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

  const badge = hasLegacyGrant
    ? <span className={`${styles.badge} ${styles.badgeWaiting}`}>{t('legacyGrant')}</span>
    : <span className={`${styles.badge} ${styles[STATUS_BADGE_STYLE[flow.status]]}`}>{t(STATUS_LABEL_KEY[flow.status])}</span>

  return (
    <div className={styles.card} data-provider-id={flow.providerId} data-auth-status={flow.status}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <span className={styles.providerName}>{flow.label}</span>
        </div>
        {badge}
      </div>

      {flow.credentialKind === 'api-key' && (
        <div className={styles.description}>{t('apiKeyConfiguredNotice')}</div>
      )}

      {flow.lastError && (
        <div className={styles.errorBanner}>{flow.lastError}</div>
      )}

      {hasLegacyGrant && (
        <div className={styles.instructionBox}>
          <div className={styles.description}>{t('legacyGrantNotice')}</div>
        </div>
      )}

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
    </div>
  )
}
