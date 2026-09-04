import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { hiddenModelKey, type HiddenModel, type ModelVisibilityGroup } from '../../model-visibility.js'
import type { ModelVisibilityBrowserRpc } from '../rpc-client.js'
import { saveHiddenModels, setModelVisible } from '../model-visibility.js'
import styles from './ModelVisibilitySection.module.css'

export interface ModelVisibilityInjected {
  rpc: ModelVisibilityBrowserRpc
  ready: Promise<unknown>
  t: TranslateNS<'usage-limits'>
}

export type ModelVisibilitySectionProps = PropsRuntime<'settings.section'> &
  InjectFace<ModelVisibilityInjected>

export function ModelVisibilitySection(props: ModelVisibilitySectionProps): React.ReactElement {
  const { rpc, ready, t } = props
  const [groups, setGroups] = useState<readonly ModelVisibilityGroup[]>([])
  const [hidden, setHidden] = useState<readonly HiddenModel[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')

  useEffect(() => {
    let active = true
    void ready.then(() => rpc.getModelVisibility()).then((value) => {
      if (!active) return
      setGroups(value.groups)
      setHidden(value.hidden)
      setStatus('ready')
    }).catch(() => {
      if (active) setStatus('error')
    })
    return () => { active = false }
  }, [ready, rpc])

  const hiddenKeys = useMemo(
    () => new Set(hidden.map((entry) => hiddenModelKey(entry.provider, entry.model))),
    [hidden],
  )

  const commit = async (next: readonly HiddenModel[]): Promise<void> => {
    const previous = hidden
    setHidden(next)
    saveHiddenModels(next)
    setStatus('saving')
    try {
      const accepted = await rpc.setHiddenModels(next)
      setHidden(accepted)
      saveHiddenModels(accepted)
      setStatus('ready')
    } catch {
      setHidden(previous)
      saveHiddenModels(previous)
      setStatus('error')
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('modelVisibilityTitle')}</h2>
          <p className={styles.subtitle}>{t('modelVisibilitySubtitle')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={hidden.length === 0 || status === 'saving'}
          onClick={() => { void commit([]) }}
        >
          {t('showAllModels')}
        </Button>
      </div>

      {status === 'loading' && <p className={styles.notice}>{t('loadingModels')}</p>}
      {status === 'error' && <p className={styles.error}>{t('modelVisibilityError')}</p>}
      {status !== 'loading' && groups.length === 0 && (
        <p className={styles.notice}>{t('noModelsConfigured')}</p>
      )}

      <div className={styles.groups}>
        {groups.map((group) => (
          <section key={group.provider} className={styles.group}>
            <h3 className={styles.groupTitle}>{group.displayName}</h3>
            <div className={styles.models}>
              {group.models.map((model) => {
                const visible = !hiddenKeys.has(hiddenModelKey(group.provider, model.id))
                return (
                  <label key={model.id} className={styles.modelRow}>
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={status === 'saving'}
                      onChange={(event) => {
                        void commit(setModelVisible(hidden, group.provider, model.id, event.target.checked))
                      }}
                    />
                    <span className={styles.modelCopy}>
                      <span className={styles.modelName}>{model.name}</span>
                      <code className={styles.modelId}>{model.id}</code>
                      {model.description && <span className={styles.description}>{model.description}</span>}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
