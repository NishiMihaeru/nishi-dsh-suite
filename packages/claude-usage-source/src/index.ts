/**
 * Official Claude CLI usage/limits source adapter.
 *
 * Uses the already-installed external Claude CLI and performs a short-lived
 * stream-json control session that issues exactly one `get_usage` request
 * without a model turn, tools, MCP servers, or credential copying.
 */
export {
  CLAUDE_EXECUTABLE_ENV,
  resolveClaudeExecutable,
  type ClaudeExecutableResolutionOptions,
  type ResolvedVendorExecutable,
} from './executable.js'
export {
  MAX_CLAUDE_STREAM_LINE_BYTES,
  claudeOutputLines,
  disposeClaudeCliChild,
} from './process.js'
export {
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  OfficialClaudeUsageSource,
  claudeUsageCliArgv,
  type OfficialClaudeUsageSourceSpec,
} from './usage.js'
