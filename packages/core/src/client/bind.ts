import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector.js'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(onStoreChange: () => void): () => void
}

export function bindSnapshotSelector<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = (fn: () => void) => source.subscribe(fn)
  const getSnapshot = () => source.getSnapshot()
  return function useSelector<S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean): S {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, sel, eq)
  }
}
