/**
 * Shared vendor CLI runtime for Nishi DSH Suite subscription-provider
 * packages: executable resolution, bounded stream decoding, process
 * disposal, settled-stderr reads, ephemeral agent workspaces, and one error
 * shape. See `docs/superpowers/specs/provider-bridge-design.md` ("The kit")
 * for the design this package implements.
 *
 * @module nishi-dsh-core/runtime
 */
export {
  resolveVendorExecutable,
  type ResolvedVendorExecutable,
  type ResolveVendorExecutableOptions,
  type VendorExecutableDescriptor,
} from './executable.js'
export {
  disposeVendorChild,
  outputLines,
} from './process.js'
export {
  settledStderr,
} from './stderr.js'
export {
  ephemeralAgentWorkspace,
  type EphemeralAgentWorkspace,
  type EphemeralAgentWorkspaceFile,
  type EphemeralAgentWorkspaceSpec,
} from './workspace.js'
export {
  recognizeVendorStderr,
  vendorFailure,
  VendorFailure,
  type RecognizedVendorStderr,
  type VendorFailureSpec,
  type VendorStderrRecognizer,
} from './failure.js'
export {
  registerProvider,
  resolveSharedProviderConfig,
  type SharedProviderConfig,
  type SharedProviderDefaults,
} from './registration.js'
export {
  type ModelCapability,
  type ProviderPresentation,
  type ProviderDescriptor,
  type RegisteredProvider,
  type UsageCapability,
  type UsageCapabilityHooks,
  type WebSearchCapability,
} from '../registry/descriptor.js'
export type {
  PrimarySearchBackend,
  PrimarySearchRequest,
  PrimarySearchSource,
  PrimaryWebSearchResult,
} from '../web-search/types.js'
export type { PrimarySearchRoute } from '../web-search/route.js'
export { NishiProvidersService } from '../registry/service.js'
