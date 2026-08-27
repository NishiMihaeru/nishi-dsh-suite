# Nishi DSH Suite

Nishi DSH Suite is a modular extension suite for DeepSeek Harness. The current development family is `0.1.0-rc.3`, targeting DeepSeek Harness `0.1.1-rc.2` and Node.js 24.

The product goal is simple: switching subscription providers should be a route change, not an environment change. DSH keeps the same tools, project memory, Usage & Limits surface, browser profile and session context while provider-specific protocol code stays behind a common core contract.

## Current architecture

The rc.3 family contains six packages:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- `nishi-dsh-codex` — canonical provider id `codex`, primary route `codex-app-server`, Codex App Server adapter, primary-history bridge, Codex-native search backend and rate-limits source;
- `nishi-dsh-antigravity` — canonical provider id `antigravity`, primary route `antigravity-cli`, official `agy`-backed primary adapter, native `search_web` backend and local usage visibility;
- `nishi-dsh-claude` — canonical provider id `claude`, usage-only capability through the installed official Claude CLI; it declares no model route and no web-search backend;
- `nishi-dsh-project-memory` — provider-agnostic project memory, context injection, `memory_read` / `memory_write` / `memory_edit`, plus `/memory` and `/consolidate` maintenance commands;
- `nishi-dsh-suite` — the Market-facing composition bundle and managed Orchestrator preset bridge.

The former `nishi-dsh-provider-kit`, `nishi-dsh-usage-limits`, `nishi-dsh-usage-limits-host`, and `nishi-dsh-primary-web-search` boundaries were folded into `nishi-dsh-core` for rc.3.

Adding a provider must not require a change to `core`, `project-memory`, or browser logic. A shipping provider still needs the expected declarative packaging changes in the Suite: dependency/bundle row and release-family metadata.

## Core lifecycle

`nishi-dsh-core` has separate host, agent and browser surfaces:

- host entry `nishi-dsh-core`: an outer plugin with no external service injection publishes `NishiProvidersService`, then mounts an internal host child that injects `nishiProviders`, `connection`, and `credentials`;
- agent entry `nishi-dsh-core/web-search`: mounted by the Orchestrator preset and resolves the current primary route through the provider registry on every call;
- browser entry `nishi-dsh-core/client`: renders Usage & Limits and Model Accounts from host RPC data;
- library entries `nishi-dsh-core/runtime` and `nishi-dsh-core/usage`: consumed by provider packages without importing the host/browser graph.

The core does not depend on a provider package. Provider plugins inject `nishiProviders` and use the shared `registerProvider()` path, which owns canonical identity validation, registry recording, adapter registration, capability construction and transactional rollback.

## Project memory

Project memory stays in the project rather than in a provider runtime:

- `DSH.md` — project contract;
- `.dsh/memory/MEMORY.md` — bounded bootstrap;
- `.dsh/memory/<topic>.md` — durable topic memories;
- `.dsh/local/` — transient local state.

A session started from a nested directory first resolves the nearest Git project root, so context injection and memory tools cannot split into different `.dsh/memory` trees. Non-Git workspaces use the explicit absolute session `cwd` as their root.

Replacement writes use `@deepseek-ai/dsh-atomic-write` while the package keeps its canonical-directory and symlink/junction refusal checks. Project memory is repository content: maintenance directives explicitly reject secrets, quota snapshots, raw chain-of-thought, transient logs and personal facts about the operator.

## Provider boundaries

### Codex

The Suite uses the user's installed official `codex` CLI/App Server. The primary invocation disables vendor-native memories and project-document injection with:

- `memories.use_memories=false`;
- `memories.generate_memories=false`;
- `project_doc_max_bytes=0`.

The Codex adapter source is based on the reviewed MIT `wingoo/codex-plugin-dsh` snapshot pinned in the package; it is not an official OpenAI plugin.

### Antigravity

The Suite uses the official `agy` executable boundary. It does not install or copy Antigravity credentials and never passes `--dangerously-skip-permissions`.

### Claude

Claude is deliberately usage-only in rc.3. A short-lived official `claude` CLI control session reads usage; the Suite does not register a Claude model adapter or search backend.

No package bundles `@openai/codex*` or `@anthropic-ai/*` runtime packages.

## Web search

There is one model-facing `web_search` tool. The current session route selects a provider's declared native backend through the registry.

- a valid route with a search backend uses that backend;
- a registered provider without search capability, or an unknown canonical route, returns `WEB_SEARCH_UNSUPPORTED`;
- malformed/non-canonical primary-route metadata returns `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- there is no DeepSeek/Exa/Perplexity fallback.

The tool re-reads the current request header per call, so a route change does not require rebuilding the tool instance.

## Authentication boundary

Nishi DSH Suite does not copy, broker, scrape, migrate, or replay vendor credential/session/token stores.

The core's Model Accounts host reads the DSH `credentials` service directly. It no longer injects or imports `@deepseek-ai/dsh-authorization`. The Suite currently retains the official authorization row as a surrounding-profile compatibility seam; that row is not a core dependency.

Vendor sign-in remains owned by each installed vendor product.

## Orchestrator preset

The packaged Orchestrator preset contains:

- routed `web_search`;
- shared project-memory tools;
- DSH-native `subagent` / `subagent_fork` delegation on the primary route.

Vendor-specific delegation tools were removed in rc.3. The current DSH `0.1.1-rc.2` launcher does not reliably preserve third-party contributed preset roots, so the Suite exposes an explicit managed bridge:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

After a Suite update use `preset update`; before Suite removal use `preset remove`. The bridge refuses to overwrite or remove an unmanaged/locally edited Orchestrator directory.

## Verification status

The current rc.3 branch has completed the provider-independent Core and Project Memory stabilization passes.

Core final acceptance proved, from fresh local tarballs in a disposable DSH home:

- `pnpm verify:local` PASS;
- vendor protocol smoke PASS for installed Codex, Antigravity and Claude CLIs at the recorded acceptance versions;
- six-package rc.3 bundle install/reinstall closure PASS;
- installed imports for `nishi-dsh-core`, `/runtime`, `/usage`, `/web-search`, `/client` PASS;
- real DSH host boot and HTTP readiness PASS;
- agent-plane `nishi-dsh-core/web-search` mount PASS;
- unload/remount without duplicate registry/RPC services PASS.

Project Memory final acceptance additionally proved:

- root-consistent nested-cwd read/write/edit behavior;
- `@deepseek-ai/dsh-atomic-write` resolution in an installed Suite profile;
- symlink/junction refusal and external-target preservation;
- real Cordis `commands + llm` maintenance-command injection;
- real disposable DSH boot PASS.

Core and Project Memory are therefore treated as **DONE / FROZEN**. The remaining rc.3 work is provider-specific cleanup and the product-level live acceptance: provider turns/search, Antigravity catalog honesty, cross-provider route switching with memory continuity, live dynamic-roster/browser checks, and release gates.

Canonical current status and next work:

- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md`
- `docs/SESSION-SUMMARY-2026-08-28.md`

Historical rc.1/rc.2 release and acceptance records remain under `docs/release/` and `docs/acceptance/` and should be read as records of those versions, not as the current rc.3 state.

Windows remains **NOT TESTED** for rc.3. No Windows compatibility claim is made.
