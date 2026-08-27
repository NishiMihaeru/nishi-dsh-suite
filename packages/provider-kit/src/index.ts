/**
 * Shared vendor CLI runtime for Nishi DSH Suite subscription-provider
 * packages: executable resolution, bounded stream decoding, process
 * disposal, settled-stderr reads, ephemeral agent workspaces, and one error
 * shape. See `docs/superpowers/specs/provider-bridge-design.md` ("The kit")
 * for the design this package implements.
 *
 * @module nishi-dsh-provider-kit
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
  claudeUsageCliArgv,
  DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  OfficialClaudeUsageSource,
  type OfficialClaudeUsageSourceSpec,
} from './claude-usage.js'
export {
  codexAppServerArgv,
  DEFAULT_REQUEST_TIMEOUT_MS,
  OfficialCodexRateLimitsSource,
  type CodexRateLimitsSourceLike,
  type OfficialCodexRateLimitsSourceSpec,
} from './codex-usage.js'
export {
  registerProvider,
  resolveSharedProviderConfig,
  type ProviderDescriptor,
  type SharedProviderConfig,
  type SharedProviderDefaults,
} from './registration.js'
