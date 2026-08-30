# nishi-dsh-claude

Claude usage-only provider plugin for Nishi DSH Suite.

## Declared capabilities

- canonical provider id: `claude`;
- usage/limits through the user's installed official Claude CLI;
- no model capability and therefore no model route;
- no web-search backend;
- no vendor-specific delegation.

This deliberately exercises capability absence in the Core contract: a provider may contribute one capability without requiring a special host/browser branch.

The old `subagent_claude_code` tool was removed in `0.1.0-rc.2` and does not return in rc.3.

## Runtime boundary

Usage is read through the installed official `claude` CLI, located via `DSH_CLAUDE_EXECUTABLE` or `PATH`. The current collector uses one short-lived stream-json control session and issues one `get_usage` request: no model turn, no tools and no MCP servers.

No `@anthropic-ai/*` package is installed as a Suite runtime dependency.

Authentication stays inside the vendor product boundary. This package does not copy, parse, broker or replay Claude credentials/session state. A missing Claude CLI degrades to an explicit unavailable usage state instead of preventing DSH startup.

## Core boundary

The provider descriptor is registered through shared `registerProvider()`. Because there is no model capability, the descriptor declares no routes. The dynamic registry/browser roster renders Claude from serialized provider presentation data rather than a provider-specific UI branch.

Generic usage caching/invalidation/projection belongs to Core; this package owns only the Claude-specific usage-source process/protocol behavior.

## Current DSH declaration

The Claude manifest declares its provider-specific DSH peers at `0.1.2-alpha.1` (`dsh-invariants`, `dsh-subprocess`, `dsh-timeout`).

`0.1.2-alpha.1` is the only supported DSH generation for this suite. The declared peers now say so, and the package's unit suite runs against alpha.1. That is weaker evidence than the other providers carry: Claude has had no live acceptance stage, and it declares neither a `model` nor a `webSearch` capability — it is a usage and account surface only. Treat alpha.1 support here as declared-and-unit-tested, not as accepted.

## Validation status — PENDING PROVIDER STAGE

Core and Project Memory are frozen. Claude is not frozen for rc.3 and remains intentionally usage-only; no Claude primary model route/search capability is part of the current rc.3 contract.

Historical tests/smokes are checkpoint-specific evidence only. The authoritative remaining work lives in `docs/ROADMAP.md`; this README describes the current package boundary rather than duplicating a task checklist.