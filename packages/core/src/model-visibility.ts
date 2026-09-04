import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'

/** Stable identity of one provider-owned model hidden from selection menus. */
export interface HiddenModel {
  readonly provider: string
  readonly model: string
}

/** One provider group rendered by the model-visibility settings section. */
export interface ModelVisibilityGroup {
  readonly provider: string
  readonly displayName: string
  readonly models: readonly LlmModelInfo[]
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Canonicalize untrusted persisted/RPC entries and remove duplicates. */
export function normalizeHiddenModels(value: unknown): HiddenModel[] {
  if (!Array.isArray(value)) return []
  const result: HiddenModel[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (!nonEmpty(row.provider) || !nonEmpty(row.model)) continue
    const entry = { provider: row.provider.trim(), model: row.model.trim() }
    const key = hiddenModelKey(entry.provider, entry.model)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }
  return result
}

/** Collision-safe internal key for a complete model route. */
export function hiddenModelKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

/** Filter an advertised catalog while leaving model resolution untouched. */
export function filterVisibleModels(
  provider: string,
  models: readonly LlmModelInfo[],
  hidden: ReadonlySet<string>,
): readonly LlmModelInfo[] {
  return models.filter((model) => !hidden.has(hiddenModelKey(provider, model.id)))
}
