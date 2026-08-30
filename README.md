# Nishi DSH Suite

Nishi DSH Suite is a modular extension suite for DeepSeek Harness. The current development family is `0.1.0-rc.3` on Node.js 24.

The only supported DeepSeek Harness generation is `0.1.2-alpha.1` (upstream tag `dsh-v0.1.2-alpha.1`, commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`). `0.1.1-rc.2` and every earlier DSH generation are **not supported**: no compatibility claim, no fixes, no new evidence.

The workspace builds and tests against alpha.1: Core and Project Memory develop against `0.1.2-alpha.1`, resolved from a local checkout of the upstream commit above, since alpha.1 is not on npm.

Every declared range says the same thing — Foundation peers, provider peers and the Suite's own DSH dependency are all `0.1.2-alpha.1`. Each provider moved on its own executable evidence rather than by inheriting the Foundation's. Those ranges cannot be installed from npm until upstream publishes alpha.1, which blocks publication, not development; see `docs/README.md`.

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

The host entry publishes `NishiProvidersService`, then mounts an internal host child that injects `nishiProviders`, `connection` and `credentials`. The agent entry `nishi-dsh-core/web-search` routes search through the current model route on each call. The browser entry renders Usage & Limits from serialized host data.

Provider plugins inject `nishiProviders` and use the shared `registerProvider()` transaction. Core does not depend on provider packages.

Legacy DSH grants remain readable compatibility state, but destructive in-app logout is disabled because the accepted alpha.1 credentials contract has no atomic compare-and-delete operation. Usage invalidation is generation-aware and authoritative for host cached reads.

### Project Memory

Project memory stays in the project:

- `DSH.md` — project contract;
- `.dsh/memory/MEMORY.md` — bounded bootstrap;
- `.dsh/memory/<topic>.md` — durable topic memory;
- `.dsh/local/` — transient local state and the crash-recovery journal.

Context injection and memory tools use the same nearest-Git-root policy, with explicit-cwd fallback for non-Git workspaces. On POSIX, package-owned descendants use a pinned `projectRoot -> .dsh -> memory/local` directory-descriptor chain. Reads validate opened file identity; current writer locks use generation-safe populated `<target>.lock` directories; named-topic + Memory-map updates use a journaled transaction with exact pre-images and generation identity.

Windows remains **NOT TESTED** for the stronger POSIX descriptor-chain/TOCTOU guarantees. Sudden power-loss durability beyond the implemented atomic filesystem protocol is out of scope because the package does not `fsync` file or parent-directory contents.

Project memory is repository-shared content, so maintenance policy rejects secrets, quota snapshots, raw chain-of-thought, transient logs and personal facts about the operator.

### Provider authentication

The Suite does not copy, broker, scrape, migrate or replay vendor credential/session/token stores.

- Codex authentication stays in the installed official `codex` product boundary.
- Antigravity authentication stays in official `agy`.
- Claude authentication stays in the installed official `claude` CLI.

Core has no Model Accounts surface and reads no vendor credential records; that section and the `account` capability behind it were removed. Core does not depend on `@deepseek-ai/dsh-authorization`; the Suite keeps the official authorization row only as a surrounding-profile compatibility seam.

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

DSH `0.1.1-rc.2` did not reliably preserve third-party contributed preset roots, so the Suite uses an explicit managed bridge. Whether alpha.1 still has that limitation has not been re-checked — if it does not, the bridge is obsolete:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Use `preset update` after a Suite update and `preset remove` before Suite removal. The bridge refuses to overwrite/remove an unmanaged or locally edited Orchestrator directory.

## Current development status

Core and Project Memory are **THAWED, PENDING RE-VALIDATION** — a follow-up audit found and fixed defects in both, reopening the freeze accepted on:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

That run's raw independent follow-up PASS report is commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

It recorded Core `182/182`, Project Memory `64/64`, full workspace test/check/build, `pnpm verify:local`, repeated Project Memory concurrency/recovery suites, zero unexpected lock/WAL residue, and disposable official DSH `0.1.2-alpha.1` runtime probes at exact upstream commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`. That evidence describes a tree this one no longer matches; see `docs/HANDOFF.md`.

On the current tree, `pnpm verify:local` exits `0` on three consecutive runs. Codex live acceptance (primary, the full 15-scenario suite, and both web-search suites) and Antigravity live acceptance (primary 8 scenarios, native and routed web search) all pass. Neither of those is independent validation by a party that did not write the code, which is still missing and is what a restored freeze claim requires.

Provider-specific acceptance is still open, but not equally unstarted: Codex has passed its own audit and live acceptance and is re-validating alongside Core/Project Memory; Antigravity's provider-specific audit, catalog rewrite, vendor-diagnostic routing and live acceptance are likewise complete, with only its freeze declaration outstanding (`docs/ROADMAP.md` §3). Claude has not started its provider stage. Historical provider tests/live probes are checkpoint-specific evidence only and do not by themselves freeze a provider stage.

`0.1.0-rc.3` is **unpublished** and **not ready to publish**. Windows remains **NOT TESTED**. No publication, merge, tag or release is authorized without explicit maintainer approval.

## Documentation

Start at [`docs/README.md`](docs/README.md). It defines the current documentation entry points and the rules used to keep status/evidence from drifting.

For development, the canonical order is:

1. `docs/HANDOFF.md`
2. `docs/ROADMAP.md`
3. `docs/ARCHITECTURE.md`
4. target package README, source and tests

Release state is in `docs/RELEASE.md`; accepted validation is summarized in `docs/verification/README.md`. Package README files describe package runtime/public boundaries and should not replace the roadmap or handoff.