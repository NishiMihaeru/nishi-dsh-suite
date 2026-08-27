/**
 * Canonical identity rules for provider ids and DSH model-route aliases.
 *
 * Identity strings cross several maps and RPC/session boundaries. They are
 * therefore stored exactly as declared: the core never silently trims or
 * rewrites them. A descriptor that is not already canonical is rejected at
 * registration time instead of producing a key whose value disagrees with
 * the registered entry.
 *
 * @module nishi-dsh-core/registry/identity
 */

export const MAX_PROVIDER_ID_LENGTH = 64
export const MAX_PROVIDER_ROUTE_LENGTH = 128

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const WHITESPACE = /\s/u

function canonicalIdentity(value: unknown, context: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`)
  }
  if (value !== value.trim()) {
    throw new Error(`${context} must not contain leading or trailing whitespace`)
  }
  if (WHITESPACE.test(value)) {
    throw new Error(`${context} must not contain whitespace`)
  }
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error(`${context} must not contain control characters`)
  }
  if (value.length > maxLength) {
    throw new Error(`${context} must be no longer than ${maxLength} characters`)
  }
  return value
}

/** Validate and return one canonical provider id without rewriting it. */
export function canonicalProviderId(value: unknown, context = 'provider id'): string {
  return canonicalIdentity(value, context, MAX_PROVIDER_ID_LENGTH)
}

/** Validate and return one canonical DSH model-route alias without rewriting it. */
export function canonicalProviderRoute(value: unknown, context = 'provider route'): string {
  return canonicalIdentity(value, context, MAX_PROVIDER_ROUTE_LENGTH)
}
