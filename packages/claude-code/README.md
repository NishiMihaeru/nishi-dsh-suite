# nishi-dsh-claude-code

Independent Claude Code subagent provider for Nishi DSH Suite, rebased on the accepted DeepSeek Harness rc.2 provider behavior.

Runtime contract:

- DSH provider ID `claude-code`;
- already-installed official `claude` executable, resolved through `DSH_CLAUDE_EXECUTABLE` then `PATH`;
- default model `claude-sonnet-5`;
- default effort `high`;
- default permission mode `auto`;
- one-shot `--print --output-format stream-json` execution with session persistence disabled;
- the real Claude CLI process tree is owned by the DSH subprocess service;
- read-only Project Memory is exposed only as `mcp__dsh-memory__memory_read` through an ephemeral authenticated loopback MCP endpoint;
- Usage & Limits uses the Claude CLI `get_usage` control request without sending a model turn.

Native Claude Code authentication and settings remain vendor-owned. This package does not install Claude Code, copy login state, bundle credentials, or manage alternate Claude homes.
