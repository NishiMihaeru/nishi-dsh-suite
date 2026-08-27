# nishi-dsh-claude-usage-source

Official local Claude CLI adapter used by Nishi DSH Suite to read account usage and rate-limit state.

It runs the already-installed external `claude` CLI in a short-lived stream-json control session, waits for `system/init`, issues a single `get_usage` control request, and shuts the process down. It never sends a model turn, creates no session state, defines no tools or MCP servers, and does not copy or broker Claude credentials.

The CLI is located through `DSH_CLAUDE_EXECUTABLE` or `PATH`. No Claude runtime is bundled with this package.
