# nishi-dsh-codex

Codex primary-provider plugin for Nishi DSH Suite.

## Declared capabilities

- canonical provider id: `codex`;
- primary model route: `codex-app-server`;
- external Codex App Server adapter and primary-history bridge;
- Codex-native web-search backend;
- official rate-limits usage source.

Vendor-specific delegation was removed in `0.1.0-rc.3`. This package no longer registers a Codex subagent provider/tool and does not own Project Memory. DSH tools and Project Memory stay on the normal primary plane when the active provider route changes.

## Runtime boundary

The primary adapter is based on the reviewed MIT `wingoo/codex-plugin-dsh` source snapshot pinned at `79fe7503390d641680bad8efade52782a3c31ced`; it is not an official OpenAI plugin.

At runtime the package uses the user's installed official `codex` CLI/App Server, located through `DSH_CODEX_EXECUTABLE` or `PATH`. No `@openai/codex*` runtime package is bundled.

Native Codex authentication remains vendor-owned. The Suite does not copy credentials, API keys, session tokens or authentication databases.

## Project-memory policy

The current primary App Server invocation disables vendor-native memories and project-doc injection with these overrides:

```text
memories.use_memories=false
memories.generate_memories=false
project_doc_max_bytes=0
```

That keeps Nishi Project Memory as the durable project-memory surface used by the Suite primary plane.

`CODEX-GLOBAL-AGENTS-001` remains `ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT` until a separately reviewed provider change replaces that policy.

## Core boundary

This package does not register the model-facing `web_search` tool itself. It contributes a native search backend through its provider descriptor; `nishi-dsh-core/web-search` owns tool registration, canonical route resolution, timeout/error taxonomy and result normalization.

Provider registration goes through shared `registerProvider()` rather than calling `ctx.llm.registerAdapter` directly.

Foundation behavior is not duplicated here: generic provider registration, shared vendor failure/runtime helpers, routed search dispatch and usage projection belong to Core.

## Current DSH declaration

The current Codex manifest still declares provider-specific DSH peers at `0.1.1-rc.2` (including `dsh-llm`, `dsh-session`, `dsh-subprocess`, `dsh-timeout`, `dsh-attachment`, `dsh-invariants` and `dsh-sdk-protocol`). Its direct `dsh-sdk-protocol` dependency is also `0.1.1-rc.2`.

The Foundation's accepted `0.1.2-alpha.1` compatibility does **not** extend this provider package automatically. Any change to Codex DSH generation support must come from the active provider-specific audit and executable validation against the exact claimed upstream contracts.

## Validation status — ACTIVE / NOT FROZEN

Core and Project Memory are frozen. Codex is the current active provider stage and must be independently audited from its current source, tests and manifest before final rc.3 freeze acceptance.

Historical Codex evidence, including the earlier `31/31` focused-test checkpoint and a live primary fixture recorded in `docs/verification/README.md`, is starting evidence only. It is not proof for the final Codex provider tree and must not be promoted across later provider changes.

The authoritative task order and acceptance requirements live in `docs/HANDOFF.md` and `docs/ROADMAP.md`; this README intentionally does not maintain a second checklist of expected findings.