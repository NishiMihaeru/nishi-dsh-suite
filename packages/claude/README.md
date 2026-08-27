# nishi-dsh-claude

Claude as a provider plugin for Nishi DSH Suite: usage and limits, and nothing else.

This package is the smallest possible provider, and that is the point. It declares exactly one capability — `usage` — and the core neither notices the absence of the others nor carries a branch for them:

- no model route: DSH does not talk to Claude through any adapter of ours;
- no search backend;
- no delegation. The `subagent_claude_code` tool was removed in `0.1.0-rc.2`.

## Runtime boundary

Usage is read through the user's installed official `claude` CLI, located via `DSH_CLAUDE_EXECUTABLE` or `PATH`. One short-lived stream-json control session issues exactly one `get_usage` request: no model turn, no tools, no MCP servers. No `@anthropic-ai/*` package is installed at runtime.

Authentication stays inside the vendor's product boundary. This package does not copy, parse, broker, or replay Claude credentials or session state, and a missing `claude` CLI degrades to an explicit unavailable row rather than an error.
