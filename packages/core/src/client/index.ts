/** DSH Web Usage / Limits & Model Accounts Browser Plugin Entry. */

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
import { UsageLimitsFooterAction } from './ui/FooterAction.js'
import { UsageLimitsSection } from './ui/SettingsSection.js'

import type { AuthorizationControllerSnapshot } from './authorization/types.js'
import { AuthorizationBrowserRpcClient } from './authorization/rpc-client.js'
import { AuthorizationClientController } from './authorization/controller.js'
import { authEn, authZh } from './authorization/locales.js'
import { ModelsAccountsSection } from './authorization/ui/ModelsAccountsSection.js'

export const NS_USAGE = 'usage-limits'
export const NS_AUTH = 'model-accounts'
export const NS = NS_USAGE

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'usage-limits': keyof typeof usageEn
    'model-accounts': keyof typeof authEn
  }
}

export interface UsageLimitsClientInjected {
  controller: UsageLimitsClientController
  useSnapshot: SnapshotSelectorHook<UsageLimitsControllerSnapshot>
  t: TranslateNS<'usage-limits'>
}

export interface ModelAccountsInjected {
  controller: AuthorizationClientController
  useSnapshot: SnapshotSelectorHook<AuthorizationControllerSnapshot>
  t: TranslateNS<'model-accounts'>
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
      const u2 = ctx.locale.register(NS_AUTH, {
        zh: authZh,
        en: authEn,
      })
      return () => {
        u1()
        u2()
      }
    },
    'usage-limits & model-accounts: copy dictionaries',
  )

  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const usageRpcClient = new UsageLimitsBrowserRpcClient(connection.rpc)
  const usageController = new UsageLimitsClientController(usageRpcClient)
  const useUsageSnapshot = bindSnapshotSelector(usageController)
  const tUsage = ctx.locale.bind(NS_USAGE)

  const authRpcClient = new AuthorizationBrowserRpcClient(connection.rpc)
  const authController = new AuthorizationClientController(authRpcClient)
  const useAuthSnapshot = bindSnapshotSelector(authController)
  const tAuth = ctx.locale.bind(NS_AUTH)

  const usageInjected = (): UsageLimitsClientInjected => ({
    controller: usageController,
    useSnapshot: useUsageSnapshot,
    t: tUsage,
  })

  const authInjected = (): ModelAccountsInjected => ({
    controller: authController,
    useSnapshot: useAuthSnapshot,
    t: tAuth,
  })

  usageController.initialize().catch(() => {})
  authController.load().catch(() => {})

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

    const unregAuth = ctx.slots.register(
      {
        name: 'settings.section',
        id: 'model-accounts',
        order: 11,
        label: () => tAuth('nav'),
        inject: authInjected,
      },
      ModelsAccountsSection,
    )

    return () => {
      unregUsage()
      unregAuth()
    }
  })

  ctx.effect(
    () => () => {
      authController.dispose()
    },
    'model-accounts: dispose auth controller',
  )

  ctx.effect(
    () => () => {
      usageController.dispose()
    },
    'usage-limits: dispose usage controller',
  )
}

export * from './controller.js'
export * from './locales.js'
export * from './rpc-client.js'
export * from './usage-group-model.js'
export * from './ui/FooterAction.js'
export * from './ui/UsageBars.js'
export * from './ui/UsageGroupBlock.js'
export * from './ui/UsageGroupDetails.js'
export * from './ui/UsageRings.js'
export * from './ui/SettingsSection.js'
export * from './view-model.js'
export * from './authorization/index.js'
