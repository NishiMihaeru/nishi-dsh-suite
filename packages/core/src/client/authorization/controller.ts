/** Observable Client Controller for Model Accounts status. */

import type {
  AuthorizationBrowserRpc,
} from './rpc-client.js'
import type {
  AuthorizationControllerSnapshot,
  SafeAuthorizationFlowDto,
} from './types.js'

export class AuthorizationClientController {
  private readonly rpc: AuthorizationBrowserRpc
  private snapshot: AuthorizationControllerSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(rpc: AuthorizationBrowserRpc) {
    this.rpc = rpc
    this.snapshot = {
      phase: 'idle',
      flows: {},
    }
  }

  getSnapshot(): AuthorizationControllerSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private setFlow(flow: SafeAuthorizationFlowDto): void {
    this.snapshot = {
      ...this.snapshot,
      flows: {
        ...this.snapshot.flows,
        [flow.providerId]: flow,
      },
      lastRefreshedAtMs: Date.now(),
    }
    this.notify()
  }

  async load(): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      phase: 'loading',
      globalError: undefined,
    }
    this.notify()

    try {
      const list = await this.rpc.listFlows()
      const flowsMap: Record<string, SafeAuthorizationFlowDto> = {}
      for (const f of list) flowsMap[f.providerId] = f

      this.snapshot = {
        phase: 'ready',
        flows: flowsMap,
        lastRefreshedAtMs: Date.now(),
        globalError: undefined,
      }
      this.notify()
    } catch (err: unknown) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'error',
        globalError: err instanceof Error ? err.message : 'Failed to load authorization flows.',
      }
      this.notify()
    }
  }

  async refreshProvider(providerId: string): Promise<SafeAuthorizationFlowDto | null> {
    try {
      const updated = await this.rpc.getProviderStatus(providerId)
      if (updated) this.setFlow(updated)
      return updated
    } catch {
      return null
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}
