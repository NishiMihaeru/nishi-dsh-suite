# Mirrored project documentation

Source: `README.md`
Mode: verbatim substantive content

---

# Nishi DSH Suite

Nishi DSH Suite is a modular extension suite for DeepSeek Harness. The current development family is `0.1.0-rc.3` on Node.js 24.

The only supported DeepSeek Harness generation is `0.1.2-rc.1` (upstream tag `dsh-v0.1.2-rc.1`). `0.1.2-alpha.1` and every earlier DSH generation are **not supported**: no compatibility claim, no fixes, no new evidence.

The workspace builds and tests against rc.1, resolved from npm like any other dependency. The local-checkout override that alpha.1 forced — alpha.1 was never published — is gone.

Every declared range says the same thing — Foundation peers, provider peers and the Suite's own DSH dependency are all `0.1.2-rc.1`, and all of them install from npm. What the rc.1 move carries is a green `pnpm verify:local` (592 unit tests); what it does not carry is any re-run live vendor suite or product-level profile acceptance — those records were gathered on alpha.1. See `docs/README.md`.

The product goal is simple: switching subscription providers should be a route change, not an environment change. DSH keeps the same tools, project memory, Usage & Limits surface, profile and session context while vendor-specific protocol code stays behind one provider-independent core contract.

## Current family

`0.1.0-rc.3` contains seven packages:

- `nishi-dsh-core` — provider registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- `nishi-dsh-codex` — provider id `codex`, route `codex-app-server`, Codex App Server adapter, primary-history bridge, native search backend and rate-limits source;
- `nishi-dsh-antigravity` — provider id `antigravity`, route `antigravity-cli`, official `agy` primary adapter with one tool transport (forced output schema), native `search_web` backend and local usage visibility;
- `nishi-dsh-claude` — provider id `claude`, usage-only through the installed official Claude CLI; no model route and no search backend;
- `nishi-dsh-grok` — provider id `grok`, route `grok-cli`, primary adapter over the installed official Grok Build CLI: one short-lived headless process per DSH step continuing one vendor session, native `web_search` backend, and Usage & Limits from ACP `_x.ai/billing`;
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
- DSH-native `subagent` / `subagent_fork` delegation, with `subagent` able to run a child on any primary route the user has authorized — `codex-app-server` and `antigravity-cli` included — and `subagent_fork` pinned to the parent's route for KV Cache reuse.

Vendor-specific delegation tools are removed in rc.3. Child route selection needs the host `subagent-model-selection` settings row (the official web-app bundle mounts it) and is off until the user authorizes exact provider/model pairs; see `packages/suite/README.md`.

DSH `0.1.1-rc.2` did not reliably preserve third-party contributed preset roots, so the Suite uses an explicit managed bridge. Whether that limitation still exists on rc.1 has not been re-checked — if it does not, the bridge is obsolete:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Use `preset update` after a Suite update and `preset remove` before Suite removal. The bridge refuses to overwrite/remove an unmanaged or locally edited Orchestrator directory.

## Install

This suite is **not** an npm package. `nishi-dsh-*` must not be installed from the registry (`dsh plugin add nishi-dsh-suite` from npm is not a supported path). Previously published `0.1.0-rc.1` has **no remaining versions** on the registry (current family names and retired rc.1 names). The only registry install in this project is DeepSeek Harness itself (`@deepseek-ai/dsh-*` at `0.1.2-rc.1`).

The git `main` line is the `0.1.0-rc.3` family.

Supported install for now is a git checkout plus local tarballs:

```bash
git clone https://github.com/NishiMihaeru/nishi-dsh-suite.git
cd nishi-dsh-suite
pnpm install --frozen-lockfile
pnpm build
pnpm pack:local
node scripts/install-local-profile.mjs --profile web
dsh plugin --profile web exec nishi-dsh-suite preset install
```

`install-local-profile` pins the six leaf packages to `file:` tarballs in that DSH profile so the Suite tarball does not resolve `nishi-dsh-*` from the registry. It is not an npm publish.

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

On the current tree, `pnpm verify:local` exits `0` on three consecutive runs. Codex live acceptance (primary, the full 15-scenario suite, and both web-search suites) and Antigravity live acceptance (primary 8 scenarios, native and routed web search) all pass, re-run in full on 2026-08-31, together with a first end-to-end cross-route delegation run. Four further live suites were added the same day and pass: the Antigravity MCP tool bridge — since removed with its transport; the record is history, not coverage of anything shipping — the vendor's enforcement of an agent tool allowlist, and — for Codex — that `thread/inject_items` actually reaches the model, alongside the existing tool-result continuation probe.

An adversarial review of the whole tree by two models that did not write it then reported 16 defects on a tree whose own gate was green. All 16 are closed: 15 confirmed and fixed, one rejected on the vendor's own contract, one referred to the maintainer and decided. Two were in code written that same day, one of them a local-socket exposure. `docs/verification/gemini/LATEST.md` has the method and the findings.

None of that is independent validation by a party that did not write the code: those reviewers' charters, and the reading of their findings, came from the author. It is still missing, and it is what a restored freeze claim requires.

Provider-specific acceptance is still open, but not equally unstarted: Codex has passed its own audit and live acceptance and is re-validating alongside Core/Project Memory; Antigravity is frozen on its documented 2026-09-04 checkpoint (`docs/ROADMAP.md` §3). Claude has not started its provider stage. Grok is implemented but still needs product-profile acceptance. Historical provider tests/live probes are checkpoint-specific evidence only and do not by themselves freeze a provider stage.

`0.1.0-rc.3` is **unpublished** and **not ready to publish**. Do not install it from npm. Windows remains **NOT TESTED**. No publication, tag or release is authorized without explicit maintainer approval. The rc.3 line is already on git `main`.

## Documentation

Start at [`docs/README.md`](docs/README.md). It defines the current documentation entry points and the rules used to keep status/evidence from drifting.

For development, the canonical order is:

1. `docs/HANDOFF.md`
2. `docs/ROADMAP.md`
3. `docs/ARCHITECTURE.md`
4. target package README, source and tests

Release state is in `docs/RELEASE.md`; accepted validation is summarized in `docs/verification/README.md`. Package README files describe package runtime/public boundaries and should not replace the roadmap or handoff.