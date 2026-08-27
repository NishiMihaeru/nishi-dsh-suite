# nishi-dsh-codex

Codex provider plugin for Nishi DSH Suite.

## Declared capabilities

- canonical provider id: `codex`;
- primary model route: `codex-app-server`;
- external Codex App Server adapter and primary-history bridge;
- Codex-native web-search backend;
- official rate-limits usage source.

Delegation was removed in `0.1.0-rc.3`. This package no longer registers a vendor subagent provider and no longer reaches project memory itself. DSH tools and project memory remain on the normal primary plane and therefore stay the same when the provider route changes.

## Runtime boundary

The primary adapter is based on the reviewed MIT `wingoo/codex-plugin-dsh` source snapshot pinned at `79fe7503390d641680bad8efade52782a3c31ced`; it is not an official OpenAI plugin.

At runtime the package uses the user's installed official `codex` CLI/App Server, located through `DSH_CODEX_EXECUTABLE` or `PATH`. No `@openai/codex*` runtime package is bundled.

Native Codex authentication remains vendor-owned. The Suite does not copy credentials, API keys, session tokens or authentication databases.

## Project-memory policy

The primary App Server invocation disables vendor-native memories and project-doc injection with exactly these overrides:

```text
memories.use_memories=false
memories.generate_memories=false
project_doc_max_bytes=0
```

That keeps DSH project memory as the durable project-memory surface used by the primary route.

`CODEX-GLOBAL-AGENTS-001` remains `ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT`.

## Core boundary

This package does not register the model-facing `web_search` tool itself. It contributes a native search backend through its descriptor; `nishi-dsh-core/web-search` owns tool registration, canonical route resolution, timeout/error taxonomy and result normalization.

Provider registration also goes through the shared `registerProvider()` path rather than calling `ctx.llm.registerAdapter` directly.

## Remaining rc.3 work

The provider-independent Core and Project Memory are frozen. Codex-specific work still includes migrating remaining provider-local failure builders to the shared core failure contract and the final live primary/search/vendor-memory-suppression acceptance.
