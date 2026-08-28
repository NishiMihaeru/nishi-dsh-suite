/**
 * The single registration path every subscription-CLI provider plugin uses.
 *
 * Before this module existed, provider packages each hand-rolled the same
 * merge/validate/register sequence. This module owns that sequence once:
 * `resolveSharedProviderConfig` owns the six shared configuration fields and
 * `registerProvider` owns provider identity/capability registration order.
 *
 * Delegation left the contract in `0.1.0-rc.3`: no provider contributes a
 * subagent provider any more, so there is no subagent step here to run.
 *
 * See `docs/ARCHITECTURE.md` for the current contract this module implements.
 *
 * @module nishi-dsh-core/runtime/registration
 */

import type { Context } from '@deepseek-ai/cordis'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ProviderDescriptor } from '../registry/descriptor.js'
import { canonicalProviderId, canonicalProviderRoute } from '../registry/identity.js'

/** Config fields every subscription-CLI provider plugin shares. */
export interface SharedProviderConfig {
  /** Explicit environment layered over DSH's credential-scrubbed child environment. */
  env?: Record<string, string>
  /** Milliseconds to retain one successful model catalog. May be `0` to disable caching. */
  modelCacheMs?: number
  /** Milliseconds allowed for login and model discovery. */
  catalogTimeoutMs?: number
  /** Milliseconds allowed for one turn. */
  turnTimeoutMs?: number
  /** Grace between managed subprocess termination tiers. */
  disposeGraceMs?: number
  /** Maximum stderr bytes retained for a failure diagnostic. */
  stderrMaxBytes?: number
}

/** `SharedProviderConfig` with every field required — the shape after defaulting. */
export type SharedProviderDefaults = Required<SharedProviderConfig>