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

The audited App Server contract is pinned to exactly `0.150.0`. A Codex CLI outside that version is a runtime-availability condition, not an internal fault: the usage source reports `UNAVAILABLE` rather than collapsing to `ERROR`, and the primary/search paths refuse to start.

### Vendor diagnostics

Raw vendor stderr never reaches a diagnostic, a DTO, or the model. Every place in this package that turns a failed Codex process into an error routes it through one authored recognizer list built on Core's `VendorFailure` contract. A recognized condition — sign-in required, stored-credential access denied, network unreachable — contributes only its own authored sentence; anything else is reported as an unattributed category plus safe exit/signal metadata. Local paths, home directories and vendor tokens therefore cannot escape through a `web_search` error or an unexpected App Server exit.

Native web search verifies the vendor runtime once per resolved executable and shares that verification across concurrent queries, rather than starting a throwaway App Server for every query in a batch.

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

Only `0.1.2-alpha.1` is a supported DSH generation for this suite; `0.1.1-rc.2` and earlier are unsupported. Those rc.2 peers are therefore unvalidated compatibility debt, not a supported target — Codex has never been probed against alpha.1, and the Foundation's accepted `0.1.2-alpha.1` compatibility does **not** extend to this provider package automatically. Any change to Codex DSH generation support must come from the active provider-specific audit and executable validation against the exact claimed upstream contracts.

## Validation status — THAWED, PENDING RE-VALIDATION

`nishi-dsh-codex` previously passed independent validation, focused test gates, and live acceptance against official `codex-cli 0.150.0`. A follow-up audit then changed this package: vendor diagnostics are sanitized through Core's `VendorFailure` contract, native-search runtime verification is cached per executable instead of run per query, an unsupported App Server version reports `UNAVAILABLE` rather than `ERROR`, the Windows batch shim covers `codex exec`, cleanup failure no longer replaces the real diagnostic, and a thread-less fatal `error` notification fails the turn instead of hanging.

That acceptance therefore describes a tree this one no longer matches. Codex's own suites pass on the current tree, but the workspace local gate fails on an unrelated Project Memory defect, and Codex has had no live acceptance run against this tree.

Accepted evidence and verification history live in `docs/verification/README.md` and `docs/verification/gemini/LATEST.md`.