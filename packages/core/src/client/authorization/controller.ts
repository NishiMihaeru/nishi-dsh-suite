/** Observable Client Controller for Models Sign-In and Authorization. */

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
  private pollingTimer: ReturnType<typeof setTimeout> | null = null

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
      this.checkInFlightPolling()
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
      if (updated) {
        this.setFlow(updated)
        this.checkInFlightPolling()
      }
      return updated
    } catch {
      return null
    }
  }

  async beginLogin(providerId: string, method?: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const optimistic = await this.rpc.beginLogin(providerId, method)
      this.setFlow(optimistic)
      this.startInFlightPolling(true)
      return optimistic
    } catch (err: unknown) {
      const current = this.snapshot.flows[providerId]
      if (current) {
        this.setFlow({
          ...current,
          status: 'ERROR',
          lastError: err instanceof Error ? err.message : 'Failed to start authorization.',
        })
      }
      throw err
    }
  }

  async submitPrompt(providerId: string, value: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const updated = await this.rpc.submitPrompt(providerId, value)
      this.setFlow(updated)
      this.startInFlightPolling(true)
      return updated
    } catch (err: unknown) {
      const current = this.snapshot.flows[providerId]
      if (current) {
        this.setFlow({
          ...current,
          status: 'ERROR',
          lastError: err instanceof Error ? err.message : 'Failed to submit authorization code.',
        })
      }
      throw err
    }
  }

  async cancelLogin(providerId: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const updated = await this.rpc.cancelLogin(providerId)
      this.setFlow(updated)
      this.checkInFlightPolling()
      return updated
    } catch (err: unknown) {
      await this.refreshProvider(providerId)
      throw err
    }
  }

  async logout(providerId: string): Promise<SafeAuthorizationFlowDto> {
    try {
      const updated = await this.rpc.logout(providerId)
      this.setFlow(updated)
      return updated
    } catch (err: unknown) {
      await this.refreshProvider(providerId)
      throw err
    }
  }

  private pollingIntervalMs = 1000

  dispose(): void {
    this.stopInFlightPolling()
    this.listeners.clear()
  }

  private startInFlightPolling(resetBackoff = false): void {
    if (resetBackoff) {
      this.pollingIntervalMs = 1000
      this.stopInFlightPolling()
    } else if (this.pollingTimer) {
      return
    }

    const poll = async () => {
      const inFlightIds = Object.values(this.snapshot.flows)
        .filter((f) => f.inFlight || f.status === 'AUTHORIZING' || f.status === 'WAITING_FOR_USER')
        .map((f) => f.providerId)

      if (inFlightIds.length === 0) {
        this.stopInFlightPolling()
        return
      }

      for (const pid of inFlightIds) await this.refreshProvider(pid)

      const stillInFlight = Object.values(this.snapshot.flows).some(
        (f) => f.inFlight || f.status === 'AUTHORIZING' || f.status === 'WAITING_FOR_USER',
      )

      if (!stillInFlight) {
        this.stopInFlightPolling()
        return
      }

      if (this.pollingIntervalMs === 1000) this.pollingIntervalMs = 2000
      else if (this.pollingIntervalMs === 2000) this.pollingIntervalMs = 5000

      this.pollingTimer = setTimeout(poll, this.pollingIntervalMs)
    }

    this.pollingTimer = setTimeout(poll, this.pollingIntervalMs)
  }

  private stopInFlightPolling(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }
    this.pollingIntervalMs = 1000
  }

  private checkInFlightPolling(): void {
    const hasInFlight = Object.values(this.snapshot.flows).some(
      (f) => f.inFlight || f.status === 'AUTHORIZING' || f.status === 'WAITING_FOR_USER',
    )
    if (hasInFlight) this.startInFlightPolling(false)
    else this.stopInFlightPolling()
  }
}
