import {
  hiddenModelKey,
  normalizeHiddenModels,
  type HiddenModel,
} from '../model-visibility.js'

export const HIDDEN_MODELS_STORAGE_KEY = 'dsh:nishi:hidden-models'

export function loadHiddenModels(storage: Pick<Storage, 'getItem'> = localStorage): HiddenModel[] {
  try {
    const raw = storage.getItem(HIDDEN_MODELS_STORAGE_KEY)
    return raw === null ? [] : normalizeHiddenModels(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveHiddenModels(
  models: readonly HiddenModel[],
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
): void {
  try {
    const normalized = normalizeHiddenModels(models)
    if (normalized.length === 0) storage.removeItem(HIDDEN_MODELS_STORAGE_KEY)
    else storage.setItem(HIDDEN_MODELS_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Web storage may be disabled or full; the current session still works.
  }
}

export function setModelVisible(
  hidden: readonly HiddenModel[],
  provider: string,
  model: string,
  visible: boolean,
): HiddenModel[] {
  const key = hiddenModelKey(provider, model)
  const next = normalizeHiddenModels(hidden).filter((entry) => hiddenModelKey(entry.provider, entry.model) !== key)
  if (!visible) next.push({ provider, model })
  return next
}
