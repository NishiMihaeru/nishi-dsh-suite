# Architecture

Status: canonical `0.1.0-rc.3` architecture. This file describes the code as it exists now.

## Product contract

Switching subscription providers should be a route change, not an environment change. DSH keeps the same tools, project memory, Usage & Limits surface, profile and session context while provider packages translate only vendor-specific protocols.

The runtime family has four architectural roles:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- one plugin per provider — vendor protocol translation and only the capabilities that provider actually exposes;
- `nishi-dsh-project-memory` — provider-agnostic project memory tools/context;
- `nishi-dsh-suite` — declarative composition and managed Orchestrator preset bridge.

A new provider must not require edits to core, Project Memory, generic usage/search logic or browser provider identity logic. A provider that ships in the Suite still requires ordinary declarative packaging changes: package dependency, bundle row and release-family metadata.

## Current package family

`0.1.0-rc.3` contains exactly:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

Canonical provider identities and model routes:

- `codex` -> `codex-app-server`
- `antigravity` -> `antigravity-cli`
- `claude` -> no model route; usage-only

Vendor-specific subagent integrations are removed. Orchestrator delegation uses DSH-native `subagent` / `subagent_fork` on the current primary route.

## Core surfaces

| Entry | Plane | Role |
|---|---|---|
| `nishi-dsh-core` | host | publish registry and compose host services |
| `nishi-dsh-core/web-search` | agent | register routed `web_search` |
| `nishi-dsh-core/client` | browser | Usage & Limits + Model Accounts UI |
| `nishi-dsh-core/runtime` | library | shared vendor runtime + registration contract |
| `nishi-dsh-core/usage` | library | normalized usage contracts/service types |

The browser never imports provider packages. Provider identity and presentation cross RPC as serialized data.

## Core lifecycle

The accepted Cordis lifecycle is registry-first:

```ts
// outer nishi-core
export const inject = [] as const

export function apply(ctx: Context, config?: UsageLimitsHostConfig): void {
  ctx.plugin(NishiProvidersService)
  ctx.plugin(hostPlugin(config))
}
```

The internal host child injects:

```ts
['nishiProviders', 'connection', 'credentials']
```

Only that child reads those services. This avoids the outer core waiting for the `nishiProviders` service that it publishes itself. Real DSH boot and unload/remount acceptance proved this lifecycle.

The core does not import or inject `@deepseek-ai/dsh-authorization`. Model Accounts reads DSH credentials directly. The Suite currently keeps the official authorization row as a surrounding-profile compatibility seam, not a core dependency and not vendor-auth brokerage.

## Provider contract

A provider injects `nishiProviders` plus only the DSH services required by its protocol, resolves config, then calls the shared registration function:

```ts
export const name = 'example-provider'
export const inject = ['nishiProviders', 'subprocess', 'llm']

export async function apply(ctx: Context, raw: Config = {}): Promise<void> {
  const config = resolveSharedProviderConfig(name, raw, DEFAULTS)
  await registerProvider(ctx, exampleDescriptor, config)
}
```

Provider packages do not directly own adapter-registration ordering. `registerProvider()` is the single path for validation, registry mutation, optional capability construction, adapter registration, install and rollback.

`NishiProvidersService.record()` is internal core machinery, not the provider-plugin API.

### Descriptor

```ts
export interface ProviderDescriptor<TConfig extends SharedProviderConfig> {
  readonly id: string
  readonly presentation: ProviderPresentation
  readonly executable: VendorExecutableDescriptor
  readonly model?: ModelCapability<TConfig>
  readonly webSearch?: WebSearchCapability<TConfig>
  readonly usage?: UsageCapability<TConfig>
  install?(ctx: Context, config: TConfig): void | Promise<void>
}

export interface ModelCapability<TConfig> {
  readonly routes: readonly string[]
  create(ctx: Context, config: TConfig): LlmAdapter
}
```

Routes live on `descriptor.model.routes`. A descriptor with `model` must declare at least one canonical route; a descriptor without `model` serves no route.

### Presentation

```ts
export interface ProviderPresentation {
  readonly id: string
  readonly displayName: string
  readonly brandColor: string
  readonly iconPath?: string
  readonly bucketsAsPools?: boolean
}
```

`presentation.id` must match the provider id. Browser grouping/presentation is data-driven rather than inferred from provider names.

### Executable

Executable lookup is descriptor-driven: explicit config, then the descriptor's environment override, then PATH. Invalid explicit overrides fail closed rather than silently choosing another binary.

### Usage

Usage source and normalization belong to the provider. Core owns generic caching, invalidation, public projection and browser lifecycle.

A registered provider with no usage capability remains visible and receives an explicit synthetic `UNSUPPORTED` public state. It is not hidden and does not receive a fake collector.

### Web search

The provider owns argv/event/result translation. Core owns the model-facing tool, request-header route parsing, canonical route validation, timeout/error taxonomy and result shape.

Per call the core:

1. reads the current agent request header;
2. validates the route;
3. resolves `ctx.nishiProviders.byRoute(route)?.webSearch`;
4. dispatches only that backend.

Malformed/unavailable route metadata -> `WEB_SEARCH_ROUTE_UNAVAILABLE`.

Valid route without a backend -> `WEB_SEARCH_UNSUPPORTED`.

There is no vendor fallback.

## Registration transaction

`registerProvider(ctx, descriptor, config)` performs:

1. provider-id validation;
2. presentation-id validation;
3. canonical/deduplicated route validation;
4. optional web-search/usage capability construction on the provider context;
5. registry record;
6. Cordis withdrawal effect binding;
7. adapter construction/registration for model providers;
8. optional provider install;
9. rollback of core-owned state if a later stage fails.

Rollback failures are aggregated with the original failure.

## Core neutrality

Production core has no provider-package dependency. Core tests include an unfamiliar synthetic fourth provider exercising registry lookup, routing, web search, late usage registration, refresh and withdrawal without production-core edits.

That proves the extension seam. It does not remove the need for Suite packaging metadata when a provider actually ships.

The Model Accounts compatibility surface contains foreign DSH credential/authorization ids such as `openai-codex`, `anthropic` and `openai`. Those are not Nishi provider ids and must not be mistaken for model-routing branches.

## Project Memory contract

Project Memory uses one root policy for context injection and tools:

- session `cwd` must be absolute;
- walk to the nearest `.git` marker, including worktree-style `.git` files;
- if no Git root exists, use normalized explicit `cwd`;
- context injection and `memory_read` / `memory_write` / `memory_edit` use that same root.

Canonical memory paths reject symlink/junction path components and non-regular targets. Replacement writes use `@deepseek-ai/dsh-atomic-write` after those checks.

`/memory` and `/consolidate` register only with both `commands` and `llm` injected. Their temporary model selection is scoped to the maintenance turn.

Project memory is repository-shared data. Maintenance policy rejects secrets, credential material, quota snapshots, raw chain-of-thought, transient logs and operator-personal facts.

## Provider-native memory policy

Project Memory is DSH-owned, but a provider whose primary vendor runtime injects its own persistent memory/project docs must suppress that behavior where the vendor boundary allows it.

Codex primary sets:

```text
memories.use_memories=false
memories.generate_memories=false
project_doc_max_bytes=0
```

Antigravity suppression remains partly configuration and partly prompt-level guidance; documentation must not overstate that as stronger enforcement than the vendor offers.

## Invariants

1. Providers register through the shared `registerProvider()` path.
2. Core has no provider-package dependency.
3. Provider ids/routes are canonical before mutation.
4. Model capability implies at least one route.
5. Capability absence is legal.
6. Browser provider identity comes from serialized presentation data.
7. Web search follows the exact current route with no fallback.
8. Stale browser async work cannot resurrect withdrawn providers.
9. Vendor-specific subagent registration/tools are absent.
10. Project Memory root selection and filesystem confinement are provider-independent.

## Current implementation state

Core and Project Memory are **DONE / FROZEN** for rc.3. Codex, Antigravity and Claude provider-specific cleanup/acceptance remain. Cross-provider live switching, dynamic-roster browser acceptance, final install/profile lifecycle and release gates remain open. See `ROADMAP.md` and `HANDOFF.md`; do not duplicate status in this file.
