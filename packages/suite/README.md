# Nishi DSH Suite

`nishi-dsh-suite` is the composition bundle for the modular Nishi integrations for DeepSeek Harness.

The current Suite family is `0.1.0-rc.3`, Node.js 24, and remains unpublished. Do not install it from npm; see the repository-root README install section.

## Compatibility status

The only supported DeepSeek Harness generation is `0.1.2-rc.1`. `0.1.2-alpha.1` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence.

The dependency graph implements that policy: the Suite carries `@deepseek-ai/dsh-authorization@0.1.2-rc.1`, and the Codex, Antigravity, Claude and Grok manifests declare their provider-specific peers at the same version.

The provider-independent Foundation packages are broader:

```text
nishi-dsh-core:           0.1.2-rc.1
nishi-dsh-project-memory: 0.1.2-rc.1
```

That earlier independent validation was run against official `dsh-v0.1.2-alpha.1` and is history: it is not evidence for rc.1, and no runtime validation has been repeated since the baseline moved. Each provider owns its own compatibility gate.

## Installed rc.3 family

The bundle installs six Nishi leaf packages at the same rc.3 version:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- `nishi-dsh-codex` — `codex` provider, `codex-app-server` primary route, native search and rate-limits source;
- `nishi-dsh-antigravity` — `antigravity` provider, `antigravity-cli` primary route, native search and local usage visibility;
- `nishi-dsh-claude` — usage-only provider through the installed official Claude CLI;
- `nishi-dsh-grok` — `grok` provider, `grok-cli` primary route, native search and local usage visibility;
- `nishi-dsh-project-memory` — root-aware project memory, context injection, memory tools and maintenance commands.

Together with this bundle package, the family contains seven packages.

Provider packages inject the Core registry and call the shared registration path. A provider may declare model, web-search and/or usage capabilities; capability absence is legal. A new provider should require no Core, Project Memory or browser identity edit, but it does require normal declarative Suite packaging metadata.

## Host-plane composition

`cordis.patch.yml` currently inserts:

- the official `@deepseek-ai/dsh-authorization` compatibility row;
- Project Memory;
- Codex, Antigravity, Claude and Grok provider plugins;
- `nishi-dsh-core`.

Provider rows may appear before the Core row because they inject `nishiProviders`; Cordis defers them until the registry exists.

The Core host lifecycle is registry-first:

1. outer `nishi-core` publishes `NishiProvidersService`;
2. internal `nishi-core-host` waits for `nishiProviders`, `connection` and `credentials`;
3. provider plugins become eligible when their own dependencies plus `nishiProviders` are present.

The Core itself no longer imports or injects the authorization service. Core has no Model Accounts surface and reads no vendor credential records; that section and the `account` capability behind it were removed. The Suite keeps the official `@deepseek-ai/dsh-authorization` row only as a surrounding-profile compatibility seam, not permission to broker vendor authentication.

## Agent-plane Orchestrator preset

The routed search tool is not a host bundle row. The packaged Orchestrator preset mounts:

```text
nishi-dsh-core/web-search
```

on the agent plane, along with shared Project Memory tools and DSH-native `subagent` / `subagent_fork` delegation.

Vendor-specific delegation tools were removed in rc.3. Delegated DSH child agents follow the active primary route instead of creating separate vendor-specific tool/memory environments.

### Subagents on another primary model

`subagent` is mounted with `modelSelectionSettings: true`, so a spawned child may run on a primary route other than its parent's — including `codex-app-server` and `antigravity-cli`. A spawned child is an ordinary DSH agent with its own session, and it reaches its model through the same `ctx.llm` adapter the parent uses, so a Suite provider needs no delegation-specific code to be usable this way. The settings catalog is built from `ctx.llm.listProviders()`, so a provider appears there as soon as it registers its adapter.

The preset grants no route by itself. Two things outside this package decide whether a child can change model:

1. the surrounding profile must mount `@deepseek-ai/dsh-tool-subagent/model-selection-settings` on the host plane — the official web-app bundle does. It is a service singleton, so this bundle deliberately does not mount a second copy; without it in the profile, the `subagent` row fails at mount time;
2. the user must enable *subagent model selection* and authorize exact provider/model pairs. The setting is off with an empty allowlist by default, it is sampled when a session's agent is published, and a route outside the allowlist is refused at delegation time. DSH still treats a spawn that names no `provider`/`model` as parent-route inheritance; that is not a Suite switch.

With selection enabled the child agent also gets `list_subagent_models` for discovering the authorized routes, and `subagent` accepts `provider`, `model` and `reasoning_effort`.

`subagent_fork` keeps model selection off on purpose: a forked child inherits the parent's completed-turn prefix, which stays eligible for KV Cache reuse only while the route is unchanged.

Spawned and forked children cannot delegate. Both tools set `maxDepth: 1`, so only the top-level Orchestrator session may call `subagent` / `subagent_fork`. A child that tries is refused at start (`subagent depth 2 exceeds maxDepth 1`). The child's catalog still lists the tool — that is DSH's depth-cap contract, not a Suite omission. Do not replace this with `toolFilter.deny`: those names are scoped to the preset, and a deny of an unknown global tool fails the spawn instead of hiding the child's own mount.

This has been run end to end, not only composed: on 2026-08-31 a Codex parent delegated to an Antigravity child, an Antigravity parent delegated to a Codex child, and one parent turn ran two concurrent background Codex children. `docs/verification/README.md` records the evidence, which is each child session's own recorded route rather than the parent model's report.

Two consequences worth knowing before turning this on. A child on a different route also routes *its* `web_search` through that vendor, because search follows the session's own primary route. And Codex opens one App Server process per active turn, so a parent plus N concurrent children on `codex-app-server` means N+1 vendor processes and N+1 concurrent draws on the same subscription quota.

## Managed preset bridge

DSH `0.1.1-rc.2` supported `$DSH_HOME/.agent-presets`, but its launcher did not reliably preserve third-party contributed preset roots, which is why this managed bridge exists. **Whether `0.1.2-rc.1` still has that limitation has not been checked** — if it does not, this bridge is obsolete and should be removed rather than carried forward. Until someone verifies that, use the installed Suite command:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

After an update:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset update
```

Before Suite removal:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset remove
dsh plugin --profile web remove nishi-dsh-suite
```

The bridge manages only `$DSH_HOME/.agent-presets/orchestrator` plus transient stage/backup siblings during atomic replacement. Ownership metadata and SHA-256 hashes prevent overwriting or deleting an unmanaged/locally edited preset directory.

The executable is run through `dsh plugin --profile <profile> exec`, so it comes from the exact Suite version installed in that DSH profile.

## Authentication and vendor runtime boundary

The Suite does not install vendor CLIs and does not copy, parse, migrate or replay vendor credential stores.

- Codex uses the installed official `codex` CLI/App Server boundary.
- Antigravity uses the installed official `agy` boundary.
- Claude usage uses the installed official `claude` CLI.
- Grok uses the installed official `grok` CLI.

The installed Suite dependency closure must remain free of `@openai/codex*` and `@anthropic-ai/*` runtime packages.

## Current verification status

Core and Project Memory were accepted and frozen at the implementation below, but a follow-up audit has since changed both, along with Codex. They are **THAWED, pending re-validation**; the evidence below is history and does not describe this tree.

Superseded accepted Foundation implementation:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw independent follow-up PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Foundation evidence includes Core `182/182`, Project Memory `64/64`, full workspace test/check/build, `pnpm verify:local`, repeated Project Memory concurrency/recovery suites, zero unexpected lock/WAL residue, bidirectional atomic-write lock interoperability, and disposable exact-commit alpha.1 runtime probes.

Provider packages are **not all frozen** for the current rc.3 provider stage. Codex has passed its own audit and live acceptance and is re-validating alongside Core/Project Memory; Antigravity is frozen on its documented 2026-09-04 checkpoint (`docs/ROADMAP.md` §3). Claude has not started its provider stage. Grok is implemented but still needs product-profile acceptance. Historical provider tests, CLI smoke runs, disposable bundle installs and earlier live fixtures remain useful checkpoint evidence, but they must not be presented as final acceptance for a later changed provider tree.

On the current tree, `pnpm verify:local` exits `0` on three consecutive runs; Codex live acceptance (primary, the full 15-scenario suite, and both web-search suites) and Antigravity live acceptance (primary 8 scenarios, native and routed web search) all pass. None of that is independent validation by a party that did not write the code, which remains the actual gap before any freeze claim.

The final Suite/product gate still requires fresh provider freezes, independent validation, repository-wide invariants, cross-provider live acceptance, install/profile lifecycle acceptance and the release commands defined in `docs/RELEASE.md`.

See `docs/HANDOFF.md` for the immediate task, `docs/ROADMAP.md` for task order, and `docs/verification/README.md` for exact accepted checkpoint evidence.

Windows remains **NOT TESTED** for rc.3.