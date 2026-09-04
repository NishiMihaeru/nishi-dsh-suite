/**
 * Reading `agy`'s own catalog and build output.
 *
 * Split out of `antigravity-primary.ts` because none of it touches the
 * adapter: it turns vendor text into values and is exercised directly by
 * `test/model-catalog.test.ts` and `test/vendor-build.test.ts`, whose names
 * had been describing this module before it existed.
 *
 * @module nishi-dsh-antigravity/model-catalog
 */
import type { AgyTurnResult } from './agy-session.js'
import { record } from './agy-vendor.js'

export const SUFFIX_RE = /^(.+)-(low|medium|high)$/
export const EFFORT_ORDER = ['low', 'medium', 'high'] as const
export type EffortLevel = (typeof EFFORT_ORDER)[number]

export const EFFORT_NAMES: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export interface CatalogModelEffort {
  readonly id: EffortLevel
  readonly name: string
  readonly aliasId: string
}

export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly efforts?: readonly CatalogModelEffort[]
  readonly aliases?: readonly string[]
}

export function stripAnsi(value: unknown): string {
  return String(value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

/**
 * Parses `agy`'s catalog text, shared by both the JSON envelope's `response`
 * field and the plain-text `agy models` fallback -- the vendor emits the
 * identical tab-separated format in both places (see `parseAgyEnvelope`).
 *
 * An entry line is `id<TAB>display name`. There is deliberately no
 * hardcoded model-family vocabulary here: any id shape is accepted. A line
 * is rejected (silently skipped, not specially recognized by wording) when:
 *   - it contains no tab at all -- this is how the `Fetching available
 *     models...` progress line is excluded, along with any other non-entry
 *     line, without matching its text;
 *   - the id (the text before the first tab) is empty;
 *   - the id contains whitespace.
 *
 * Duplicate ids collapse to the LAST matching line (last-writer-wins). This
 * matches the pre-existing behavior of both catalog paths it replaces and
 * falls out naturally from `Map#set` during a single forward pass, so no
 * extra branching is needed to get it. A duplicate id is a vendor bug
 * either way; last-writer-wins is simply the deterministic, unsurprising
 * choice rather than an attempt to reconcile or paper over that bug.
 */
export function parseCatalogEntries(text: string): CatalogModel[] {
  const rows = new Map<string, CatalogModel>()
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const tabIndex = raw.indexOf('\t')
    if (tabIndex === -1) continue
    const id = raw.slice(0, tabIndex)
    if (id.length === 0 || /\s/.test(id)) continue
    const display = raw.slice(tabIndex + 1).trim()
    rows.set(id, { id, name: display.length > 0 ? display : id })
  }
  return [...rows.values()]
}

function cleanDisplayName(name: string): string {
  return name.replace(/ \((Low|Medium|High)\)$/, '')
}

export function aggregateCatalogModels(rawModels: readonly CatalogModel[]): CatalogModel[] {
  const groups = new Map<string, { model: CatalogModel; effort: EffortLevel }[]>()
  for (const model of rawModels) {
    const match = model.id.match(SUFFIX_RE)
    if (match) {
      const baseId = match[1]
      const effort = match[2] as EffortLevel
      const list = groups.get(baseId) ?? []
      list.push({ model, effort })
      groups.set(baseId, list)
    }
  }

  const collapsedGroups = new Map<string, CatalogModel>()
  const collapsedRawIds = new Set<string>()

  for (const [baseId, items] of groups.entries()) {
    const distinctEfforts = new Set(items.map(item => item.effort))
    if (distinctEfforts.size >= 2) {
      for (const item of items) {
        collapsedRawIds.add(item.model.id)
      }
      const efforts: CatalogModelEffort[] = []
      for (const level of EFFORT_ORDER) {
        const found = items.find(item => item.effort === level)
        if (found) {
          efforts.push({
            id: level,
            name: EFFORT_NAMES[level],
            aliasId: found.model.id,
          })
        }
      }
      const preferred = items.find(item => item.effort === 'high') ?? items[0]
      const name = cleanDisplayName(preferred.model.name)
      collapsedGroups.set(baseId, {
        id: baseId,
        name: name.length > 0 ? name : baseId,
        efforts,
        aliases: efforts.map(e => e.aliasId),
      })
    }
  }

  const result: CatalogModel[] = []
  const emittedBaseIds = new Set<string>()

  for (const model of rawModels) {
    if (collapsedRawIds.has(model.id) || collapsedGroups.has(model.id)) {
      const match = model.id.match(SUFFIX_RE)
      const baseId = match ? match[1] : model.id
      if (!emittedBaseIds.has(baseId)) {
        emittedBaseIds.add(baseId)
        const collapsed = collapsedGroups.get(baseId)
        if (collapsed) result.push(collapsed)
      }
    } else {
      result.push(model)
    }
  }

  return result
}

/**
 * Parses the `--output-format json models` envelope. The vendor does not
 * emit a structured model list here: it emits the same tab-separated text
 * `parseCatalogEntries` already understands, as a string under `response`,
 * wrapped in the same `{conversation_id, status, response}` envelope shape
 * used for turn results (`AgyTurnResult`) -- so it's reused here rather than
 * inventing a parallel type.
 *
 * `stdout` may carry a leading informational line (e.g. `Fetching available
 * models...`) before the JSON envelope; that line simply fails `JSON.parse`
 * and is skipped without matching its wording. Returns `undefined` when no
 * line parses as a JSON object, signaling the caller to fall back to the
 * plain-text `agy models` invocation instead.
 */
export function parseAgyEnvelope(stdout: string): AgyTurnResult | undefined {
  for (const raw of stripAnsi(stdout).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const row = record(parsed)
    if (row) return row as AgyTurnResult
  }
  return undefined
}

/**
 * A version-shaped token, and nothing else, out of `agy --version` output.
 *
 * `--version` output is vendor-authored text like every other byte this
 * package reads back from the CLI, so it goes through the same discipline the
 * stderr recognisers follow: only a token matched by this pattern is kept,
 * never the line it sat on and never the text around it. Measured on real
 * `agy 1.1.25`, the whole output is the bare `1.1.25`, but a vendor free to
 * print `agy version 1.2.0 (abc123)` tomorrow must not thereby get a
 * paragraph of its own choosing into a DSH diagnostic.
 */
const VENDOR_BUILD_TOKEN = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?)(?:\s|$)/

export function parseVendorBuild(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const match = VENDOR_BUILD_TOKEN.exec(line.trim())
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
}
