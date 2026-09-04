/** DSH Web Usage / Limits Browser Plugin Entry. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { bindSnapshotSelector } from './bind.js'
import type {
  SnapshotSelectorHook,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageLimitsControllerSnapshot } from './controller.js'
import { UsageLimitsClientController } from './controller.js'
import { en as usageEn, zh as usageZh } from './locales.js'
import { UsageLimitsBrowserRpcClient } from './rpc-client.js'
import { loadHiddenModels } from './model-visibility.js'
import { UsageLimitsFooterAction } from './ui/FooterAction.js'
import { ModelVisibilitySection } from './ui/ModelVisibilitySection.js'
import { UsageLimitsSection } from './ui/SettingsSection.js'

export const NS_USAGE = 'usage-limits'
export const NS = NS_USAGE

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'usage-limits': keyof typeof usageEn
  }
}

export interface UsageLimitsClientInjected {
  controller: UsageLimitsClientController
  useSnapshot: SnapshotSelectorHook<UsageLimitsControllerSnapshot>
  t: TranslateNS<'usage-limits'>
}

export const inject = [
  'slots',
  'locale',
  'connection',
]

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => {
      const u1 = ctx.locale.register(NS_USAGE, {
        zh: usageZh,
        en: usageEn,
      })
      return () => {
        u1()
      }
    },
    'usage-limits: copy dictionaries',
  )

  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const usageRpcClient = new UsageLimitsBrowserRpcClient(connection.rpc)
  const modelVisibilityReady = usageRpcClient.setHiddenModels(loadHiddenModels()).catch(() => [])
  const usageController = new UsageLimitsClientController(usageRpcClient)
  const useUsageSnapshot = bindSnapshotSelector(usageController)
  const tUsage = ctx.locale.bind(NS_USAGE)

  const usageInjected = (): UsageLimitsClientInjected => ({
    controller: usageController,
    useSnapshot: useUsageSnapshot,
    t: tUsage,
  })

  usageController.initialize().catch(() => {})

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'usage-limits',
        order: 50,
        inject: usageInjected,
      },
      UsageLimitsFooterAction,
    ),
  )

  ctx.slots.inject('settings.section', () => {
    const unregUsage = ctx.slots.register(
      {
        name: 'settings.section',
        id: 'usage-limits',
        order: 50,
        label: () => tUsage('nav'),
        inject: usageInjected,
      },
      UsageLimitsSection,
    )
    const unregModelVisibility = ctx.slots.register(
      {
        name: 'settings.section',
        id: 'model-visibility',
        order: 45,
        label: () => tUsage('modelVisibilityNav'),
        inject: () => ({ rpc: usageRpcClient, ready: modelVisibilityReady, t: tUsage }),
      },
      ModelVisibilitySection,
    )

    return () => {
      unregModelVisibility()
      unregUsage()
    }
  })

  ctx.effect(
    () => () => {
      usageController.dispose()
    },
    'usage-limits: dispose usage controller',
  )
}

export * from './auto-refresh.js'
export * from './controller.js'
export * from './locales.js'
export * from './model-visibility.js'
export * from './rpc-client.js'
export * from './usage-group-model.js'
export * from './ui/FooterAction.js'
export * from './ui/ModelVisibilitySection.js'
export * from './ui/UsageBars.js'
export * from './ui/UsageGroupBlock.js'
export * from './ui/UsageGroupDetails.js'
export * from './ui/UsageRings.js'
export * from './ui/SettingsSection.js'
export * from './view-model.js'
