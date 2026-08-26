# nishi-dsh-claude-code

Independent Claude Code subagent provider for Nishi DSH Suite, rebased on the accepted DeepSeek Harness rc.2 provider behavior.

Runtime contract:

- DSH provider ID `claude-code`;
- `@anthropic-ai/claude-agent-sdk@0.3.220`;
- default model `claude-sonnet-5`;
- default effort `high`;
- default permission mode `auto`;
- one-shot text execution with `persistSession: false`;
- official SDK process projected into DSH subprocess ownership;
- read-only Project Memory exposed only as `mcp__dsh-memory__memory_read`.

Native Claude Code authentication and settings remain vendor-owned. This package does not install Claude Code, copy login state, bundle credentials, or manage alternate Claude homes.
