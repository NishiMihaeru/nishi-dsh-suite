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
 * Absent means empty. Present-but-not-an-object is a protocol error.
 * Isolation uses this so a shapeless `mcp_servers`/`apps` cannot silently
 * disable nothing and leave vendor tools on.
 */
export function optionalObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  return object(value, label)
}
