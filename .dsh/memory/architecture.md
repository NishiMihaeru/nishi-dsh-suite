# Architecture (durable digest)

Canonical source: `docs/ARCHITECTURE.md`. Supporting contracts: root `README.md`, package READMEs, `docs/HANDOFF.md`, and `docs/verification/*-cli-contract.md`.

## Product and package boundary
- Nishi DSH Suite development family is `0.1.0-rc.3` on Node.js 24 and contains seven packages: Core, Codex, Antigravity, Claude, Grok, Project Memory, and Suite.
- The only supported DSH generation is official `0.1.2-rc.1`; `0.1.2-alpha.1` and earlier are unsupported. All declared ranges and the workspace graph use rc.1 from npm. The Nishi family itself is `private` on git `main` and is not installed from npm; previously published `0.1.0-rc.1` has no remaining registry versions.
- Switching primary providers must be a route change, not an environment change. Tools, Project Memory, Usage & Limits, profile, and session context remain provider-independent.
- A new provider must not require provider-specific branches in Core, Project Memory, generic usage/search logic, or browser identity logic.

## Core
- Core publishes `NishiProvidersService`; provider plugins inject it and register through transactional `registerProvider()`.
- Core owns provider registration, shared vendor-process helpers, routed `web_search`, normalized usage/cache/invalidation, host RPC, and browser UI. Vendor protocols remain in provider packages.
- Core has no Model Accounts or credential-mutation surface and does not import/inject DSH authorization. The host compatibility child still injects `credentials`, but Core does not read or mutate vendor credential records.
- Search resolves the exact current route on every call, has no cross-vendor fallback, and treats returned web text as untrusted.
- Vendor-process diagnostics must be constructed through `VendorFailure`; raw vendor output must not reach users, DTOs, or models.

## Provider routes
- **Codex:** provider `codex`, route `codex-app-server`, installed official Codex App Server, native search, official rate-limit source. Runtime floor is Codex `0.150.0`; no upper pin. Ordinary turns resume one persistent vendor thread per DSH session and realign through checkpoint digest + resume/rollback/fork/rebuild. Each DSH step is one completed vendor turn under `turn/start.outputSchema`; no parked vendor tool call. Auxiliary requests use isolated ephemeral threads. Vendor-native memories/project-doc injection are disabled. The usable context window is learned from `thread/tokenUsage/updated` after a turn.
- **Antigravity:** provider `antigravity`, route `antigravity-cli`, installed official `agy`, native `search_web`, and quota from published `agy -p "/usage" --output-format json`. One live CLI child is kept per DSH session using full/delta envelopes; continuation requires exact agreement with the delivered wire prefix. The forced-schema transport types tool arguments, stamps every turn, and permits one bounded repair restatement for a stale/missing decision. The removed MCP bridge and `transport` option are historical only. The route advertises a deployment-owned context window, default `200000`.
- **Claude:** provider `claude`, usage-only in rc.3; no model route and no search. A thin stepped primary route is researched but not implemented.
- **Grok:** provider `grok`, route `grok-cli`, installed official Grok Build CLI. One short-lived headless process per DSH step continues one vendor session; `--resume` preserves prefix caching across processes. Isolation requires the non-obvious paired tool allow/deny flags plus MCP denial; `--tools ""` fails open and must never replace that form. Usage comes from ACP `_x.ai/billing`. Routed native `web_search` is a separate hidden headless turn pinned to `grok-4.5`/low while the primary route keeps web search disabled. Model/context/effort metadata comes from the ACP initialization catalog.

## Project Memory
- Canonical state: `DSH.md`, `.dsh/project.json`, bounded `.dsh/memory/MEMORY.md`, named topics, and transient `.dsh/local/`.
- Root discovery walks to the nearest Git marker, otherwise uses normalized absolute cwd. Context and tools share one root policy.
- POSIX storage pins `projectRoot -> .dsh -> memory/local` by directory identity, refuses symlink/non-file substitution, and validates opened-file identity. Windows is NOT TESTED for these guarantees.
- Bootstrap limit is 25 KiB / 200 lines; named topic limit is 256 KiB. Every read-modify-write path has a materialization bound.
- Writers use generation-safe populated `<target>.lock` directories. Named-topic updates lock `MEMORY.md` then the topic and use a journal with exact pre-images, process identity, transaction generation, and `pending` rollback versus `committed` preserve-and-clean semantics.
- Caller cancellation applies to ordinary work; after a partial durable replacement, mandatory settlement may ignore the fired signal only long enough to restore coherent state. No `fsync` durability claim is made.

## Cross-provider invariants
- Provider ids/routes are canonical before mutation; capability absence is legal.
- Browser identity and usage roster are registry-derived; invalidation generations prevent stale state from being republished.
- A vendor conversation surviving more than one DSH step must record/digest the exact wire prefix, refuse continuation across rewritten history, and rebuild or realign from authoritative DSH history.
- Producer-supplied context blocks unsupported by a vendor are projected to text only on the transient request; durable DSH history is never rewritten.
- Subagent routing is DSH-native. The Suite enables explicit route selection only for `subagent`; `subagent_fork` remains on the parent route for KV-cache reuse. Delegation depth is capped at one and exact provider/model permission is user-maintained.
- Vendor authentication/session/token stores stay inside official vendor products and are never copied, parsed, migrated, deleted, or replayed by the Suite.

## Status
- Foundation (Core + Project Memory) and Codex are thawed pending independent re-validation.
- Antigravity is frozen on its documented 2026-09-04 checkpoint; vendor self-update triggers live-suite re-runs, not automatic architectural reopening.
- Claude remains usage-only and has not completed a provider stage.
- Grok is implemented with unit/live-primary evidence but remains pre-acceptance at product-profile level.
- The family is unpublished, all seven packages are `private`, and `nishi-dsh-*` must not be installed from npm (the registry still serves stale rc.1). Supported install is a git checkout plus local tarballs (`pnpm pack:local`, `scripts/install-local-profile.mjs`). No publish, merge, tag, or release without explicit maintainer approval. Windows remains NOT TESTED.