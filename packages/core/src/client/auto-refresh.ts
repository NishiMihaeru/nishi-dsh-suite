export const USAGE_AUTO_REFRESH_INTERVAL_MS = 60_000

export interface UsageAutoRefreshScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
  isPaused(): boolean
  subscribeResume(callback: () => void): () => void
}

/**
 * Periodically refresh usage without overlapping calls. Refreshes pause while
 * the browser cannot usefully update and resume as soon as it becomes active.
 */
export function startUsageAutoRefresh(
  refresh: () => Promise<void>,
  scheduler: UsageAutoRefreshScheduler,
  intervalMs = USAGE_AUTO_REFRESH_INTERVAL_MS,
): () => void {
  let disposed = false
  let refreshing = false

  const run = (): void => {
    if (disposed || refreshing || scheduler.isPaused()) return
    refreshing = true
    void refresh()
      .catch(() => {})
      .finally(() => {
        refreshing = false
      })
  }

  const handle = scheduler.setInterval(run, intervalMs)
  const unsubscribeResume = scheduler.subscribeResume(run)

  return () => {
    disposed = true
    scheduler.clearInterval(handle)
    unsubscribeResume()
  }
}

export function createBrowserUsageAutoRefreshScheduler(): UsageAutoRefreshScheduler {
  return {
    setInterval(callback, intervalMs) {
      return window.setInterval(callback, intervalMs)
    },
    clearInterval(handle) {
      window.clearInterval(handle as number)
    },
    isPaused() {
      return document.visibilityState === 'hidden' || navigator.onLine === false
    },
    subscribeResume(callback) {
      const onVisibilityChange = () => {
        if (document.visibilityState !== 'hidden') callback()
      }
      const onOnline = () => callback()
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('online', onOnline)
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('online', onOnline)
      }
    },
  }
}
