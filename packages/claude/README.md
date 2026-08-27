# nishi-dsh-claude

Claude as a usage-only provider plugin for Nishi DSH Suite.

## Declared capabilities

- canonical provider id: `claude`;
- usage/limits through the user's installed official Claude CLI;
- no model capability and therefore no model route;
- no web-search backend;
- no vendor delegation.

This deliberately exercises capability absence in the core contract: a provider may contribute one capability without requiring a special branch in host composition or browser code.

The old `subagent_claude_code` tool was removed in `0.1.0-rc.2` and does not return in rc.3.

## Runtime boundary

Usage is read through the installed official `claude` CLI, located via `DSH_CLAUDE_EXECUTABLE` or `PATH`. One short-lived stream-json control session issues exactly one `get_usage` request: no model turn, no tools and no MCP servers.

No `@anthropic-ai/*` package is installed as a Suite runtime dependency.

Authentication stays inside the vendor product boundary. This package does not copy, parse, broker or replay Claude credentials/session state. A missing Claude CLI degrades to an explicit unavailable usage state instead of preventing DSH startup.

## Core boundary

The descriptor is registered through the shared `registerProvider()` path. Because there is no model capability, the descriptor declares no routes. The dynamic registry/browser roster still renders the provider from `ProviderPresentation` data.

## Remaining rc.3 work

The provider-independent Core and Project Memory are frozen. Claude-specific remaining work is limited to the provider-level cleanup/failure-contract sweep and final release acceptance; no Claude primary-route work is planned for rc.3.
