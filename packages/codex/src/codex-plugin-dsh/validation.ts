/** Runtime validation helpers for values crossing the App Server JSON boundary. */

/** Return a JSON object or reject the named protocol value. */
export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`codex-plugin-dsh: App Server returned invalid ${label}`)
  }
  return value as Record<string, unknown>
}

/** Return a non-empty string or reject the named protocol value. */
export function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`codex-plugin-dsh: App Server returned invalid ${label}`)
  }
  return value
}

/** Normalize an unknown rejection into an Error without discarding its text. */
export function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** Read an optional string field from a JSON object. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Unset means empty. Present-but-shapeless is a protocol error. Isolation uses
 * this so a `mcp_servers`/`apps` of the wrong shape cannot silently disable
 * nothing and leave vendor tools on.
 *
 * `null` is unset, not shapeless. Real `codex-cli 0.150.0` answers `config/read`
 * with `apps: null` on a machine that has none -- the key is present and the
 * value is `null` -- and the same file spells every other unset option that way
 * (`review_model: null`, `model_context_window: null`). Rejecting it took the
 * whole provider out: `test:live:primary` failed with `invalid config/read apps`
 * before the first turn could start, while every unit test passed because each
 * fixture supplied an object or omitted the key.
 *
 * A string, number, or array still fails: those carry a shape this code would
 * misread, which is what failing closed is for.
 */
export function optionalObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return object(value, label)
}
