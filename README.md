# Nishi DSH Suite

Nishi DSH Suite is a modular extension suite for DeepSeek Harness. The current development family is `0.1.0-rc.3`, targeting DeepSeek Harness `0.1.1-rc.2` and Node.js 24.

The product goal is simple: switching subscription providers should be a route change, not an environment change. DSH keeps the same tools, project memory, Usage & Limits surface, profile and session context while vendor-specific protocol code stays behind one provider-independent core contract.

## Current family

`0.1.0-rc.3` contains six packages:

- `nishi-dsh-core` — provider registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- `nishi-dsh-codex` — provider id `codex`, route `codex-app-server`, Codex App Server adapter, primary-history bridge, native search backend and rate-limits source;
- `nishi-dsh-antigravity` — provider id `antigravity`, route `antigravity-cli`, official `agy` primary adapter, native `search_web` backend and local usage visibility;
- `nishi-dsh-claude` — provider id `claude`, usage-only through the installed official Claude CLI; no model route and no search backend;
- `nishi-dsh-project-memory` — provider-agnostic project memory, context injection, `memory_read` / `memory_write` / `memory_edit`, plus `/memory` and `/consolidate`;
- `nishi-dsh-suite` — Market-facing composition bundle and managed Orchestrator preset bridge.

The old provider-kit, usage-limits, usage-limits-host and primary-web-search package boundaries are folded into Core for rc.3.

Adding a provider must not require edits to Core, Project Memory, generic usage/search logic or browser provider identity logic. Shipping it still requires normal Suite dependency/bundle/release-family metadata.

## Runtime boundaries

### Core

The host entry publishes `NishiProvidersService`, then mounts an internal host child that injects `nishiProviders`, `connection` and `credentials`. The agent entry `nishi-dsh-core/web-search` routes search through the current model route on each call. The browser entry renders Usage & Limits and Model Accounts from serialized host data.

Provider plugins inject `nishiProviders` and use the shared `registerProvider()` transaction. Core does not depend on provider packages.

### Project Memory

Project memory stays in the project:

- `DSH.md` — project contract;
- `.dsh/memory/MEMORY.md` — bounded bootstrap;
- `.dsh/memory/<topic>.md` — durable topic memory;
- `.dsh/local/` — transient local state.

Context injection and memory tools use the same nearest-Git-root policy, with explicit-cwd fallback for non-Git workspaces. On POSIX, package-owned descendants use a pinned `projectRoot -> .dsh -> memory/local` directory-descriptor chain. Replacement writes stay on the opened parent scope and publish atomically by rename; first publication is complete-before-visible and no-clobber via sibling temp files plus hard-link publication. Windows remains untested for the stronger descriptor-chain TOCTOU guarantee.

Project memory is repository-shared content, so maintenance policy rejects secrets, quota snapshots, raw chain-of-thought, transient logs and personal facts about the operator.

### Provider authentication

The Suite does not copy, broker, scrape, migrate or replay vendor credential/session/token stores.

- Codex authentication stays in the installed official `codex` product boundary.
- Antigravity authentication stays in official `agy`.
- Claude authentication stays in the installed official `claude` CLI.

Core reads DSH credentials for the Model Accounts compatibility surface. It does not depend on `@deepseek-ai/dsh-authorization`; the Suite currently keeps the official authorization row only as a surrounding-profile compatibility seam.

No package bundles `@openai/codex*` or `@anthropic-ai/*` runtime packages.

## Web search

There is one model-facing `web_search` tool. The current session route selects the provider's declared native backend through the registry.

- malformed/non-canonical route metadata -> `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- valid route without a search backend -> `WEB_SEARCH_UNSUPPORTED`;
- no DeepSeek/Exa/Perplexity fallback.

The tool re-reads the current request route per call, so route switching does not require rebuilding the tool.

## Orchestrator preset

The packaged Orchestrator preset provides:

- routed `web_search`;
- shared Project Memory tools;
- DSH-native `subagent` / `subagent_fork` delegation on the current primary route.

Vendor-specific delegation tools are removed in rc.3.

DSH `0.1.1-rc.2` does not reliably preserve third-party contributed preset roots, so the Suite currently uses an explicit managed bridge:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Use `preset update` after a Suite update and `preset remove` before Suite removal. The bridge refuses to overwrite/remove an unmanaged or locally edited Orchestrator directory.

## Current development status

Core and Project Memory are **DONE / FROZEN** after fresh package/workspace verification and disposable official DSH `0.1.2-alpha.1` runtime acceptance on implementation checkpoint `eb95ef6425c788f63339befd0c2437f78bc8dde1`.

Remaining rc.3 work is provider-specific:

1. Codex cleanup/focused/live acceptance;
2. Antigravity cleanup, catalog honesty/tests and live acceptance;
3. Claude usage-only cleanup/smoke;
4. repository-wide provider invariants;
5. cross-provider/product live acceptance;
6. final install/profile/release gates.

`0.1.0-rc.3` is **unpublished**. Windows remains **NOT TESTED**. No publication/merge/tag/release is authorized without explicit maintainer approval.

## Documentation

Start at [`docs/README.md`](docs/README.md). It defines the only current documentation entry points and the rules agents must follow to avoid stale/duplicate plans and reports.

For development, the canonical order is:

1. `docs/HANDOFF.md`
2. `docs/ROADMAP.md`
3. `docs/ARCHITECTURE.md`
4. target package README/source/tests

Release state is in `docs/RELEASE.md`; accepted validation is summarized in `docs/verification/README.md`.
