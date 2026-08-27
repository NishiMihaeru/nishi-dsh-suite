# Core Connector Contract

**Status:** canonical `0.1.0-rc.3` architecture as implemented and accepted through Core 14 on 2026-08-28.

This document describes the current contract, not the earlier kit-era design. Historical designs remain under dated files in `docs/superpowers/specs/`.

## Goal

Working across subscription providers should be a route change, not an environment change.

Two kinds of runtime package implement that goal:

1. `nishi-dsh-core` owns provider-independent seams: provider registry/registration, shared vendor runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces.
2. One package per provider owns vendor protocol translation and declares only the capabilities that provider actually supplies.

`nishi-dsh-project-memory` deliberately stays separate from the core. It exposes ordinary DSH memory tools and context injection, so providers do not transport or implement project memory themselves.

Adding a provider must require **no edit to core, project-memory, usage host logic, web-search routing logic or browser code**. A provider that ships in the Suite still requires normal declarative packaging changes: add the package dependency/bundle row and release-family metadata.

## Decisions of record

1. **Vendor-specific delegation is removed.** `subagent_codex`, `subagent_antigravity` and their vendor child-agent/memory transports are gone. The Orchestrator preset uses DSH-native `subagent` / `subagent_fork` on the current primary route.
2. **One provider-independent core package.** The former provider-kit, usage-limits, usage-limits-host and primary-web-search boundaries are folded into `nishi-dsh-core`.
3. **Claude is usage-only.** It has no model capability, routes or web-search backend in rc.3.
4. **Canonical provider id and model route are separate.** Provider ids are `codex`, `antigravity`, `claude`; preserved DSH model routes include `codex-app-server` and `antigravity-cli`.
5. **Project memory stays provider-agnostic.** Providers neither inject nor write project memory. `memory_read`, `memory_write` and `memory_edit` are DSH tools.
6. **No vendor fallback for search.** A provider without search support yields an explicit unsupported result; malformed route metadata is a separate route-unavailable error.
7. **Capability absence is legal.** A provider may omit model, webSearch or usage without forcing special-case composition code.

## Package and plane layout

| Entry | Plane | Role |
|---|---|---|
| `nishi-dsh-core` | host | publish registry and compose host services |
| `nishi-dsh-core/web-search` | agent | register routed `web_search` |
| `nishi-dsh-core/client` | browser | Usage & Limits + Model Accounts UI |
| `nishi-dsh-core/runtime` | library | shared vendor runtime + registration contract |
| `nishi-dsh-core/usage` | library | normalized usage contracts/collector/service types |
| `nishi-dsh-project-memory` | host/agent hooks | project root discovery, context injection, memory tools/commands |

The browser never imports a provider package. Provider identity/presentation crosses RPC as serialized data.

## Core host lifecycle

The accepted Cordis lifecycle is registry-first and split between an outer and inner plugin.

```ts
// outer nishi-core
export const inject = [] as const

export function apply(ctx: Context, config?: UsageLimitsHostConfig): void {
  ctx.plugin(NishiProvidersService)
  ctx.plugin(hostPlugin(config))
}
```

The internal host child declares:

```ts
inject: ['nishiProviders', 'connection', 'credentials']
```

Only that child reads `ctx.nishiProviders`, `ctx.connection` or `ctx.credentials`.

This avoids a self-dependency where the outer core would wait for the `nishiProviders` service it is itself responsible for publishing. Real DSH boot and unload/remount acceptance proved this lifecycle.

The core no longer imports or injects `@deepseek-ai/dsh-authorization`. The Model Accounts host reads credentials directly. The Suite currently retains an official authorization row as a surrounding-profile compatibility seam.

## Provider plugin contract

A provider injects `nishiProviders` plus only the DSH services needed by its protocol implementation, resolves config, then calls the shared registration function.

```ts
export const name = 'example-provider'
export const inject = ['nishiProviders', 'subprocess', 'llm']

export async function apply(ctx: Context, raw: Config = {}): Promise<void> {
  const config = resolveSharedProviderConfig(name, raw, DEFAULTS)
  await registerProvider(ctx, exampleDescriptor, config)
}
```

Provider packages do **not** call `ctx.llm.registerAdapter` directly. `registerProvider()` is the single path that owns core registration order and rollback.

`NishiProvidersService.record()` is an internal registry operation used by `registerProvider()`, not the public provider-plugin registration API.

## Descriptor shape

The implemented shape is:

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

Routes belong to the model capability because a provider with no model serves no route. `registerProvider()` derives `RegisteredProvider.routes` from `descriptor.model?.routes ?? []` and validates them before mutation.

A descriptor with `model` must declare at least one canonical route. A descriptor without `model` declares no model routes by construction.

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

`presentation.id` must match `descriptor.id`. The record is serializable and crosses RPC. `bucketsAsPools` is a provider-declared rendering hint for BUCKET-scoped usage windows; the browser does not infer provider behavior from names or substrings.

### Executable

```ts
export interface VendorExecutableDescriptor {
  readonly id: string
  readonly defaultName: string
  readonly envOverride: string
  readonly windowsName?: string
  readonly productName?: string
}
```

Executable selection is provider-data-driven. Invalid explicit overrides fail closed instead of silently selecting a different binary.

### Model

```ts
export interface ModelCapability<TConfig> {
  readonly routes: readonly string[]
  create(ctx: Context, config: TConfig): LlmAdapter
}
```

Absent means the provider is not selectable as a primary through a Nishi adapter.

The model catalog must not hide otherwise valid models merely because their family prefix is unfamiliar. The remaining Antigravity family filter is provider-specific rc.3 work, not a core contract feature.

### Web search

```ts
export interface WebSearchCapability<TConfig> {
  create(ctx: Context, config: TConfig): PrimarySearchBackend
}
```

The provider owns argv/event/result translation. The core owns the model-facing tool, request-header route parsing, canonical route validation, timeout/error taxonomy and result shape.

Per call:

1. read the current agent request header;
2. validate the provider route with `canonicalProviderRoute()`;
3. resolve `ctx.nishiProviders.byRoute(route)?.webSearch`;
4. dispatch only that backend.

Malformed/unavailable route metadata → `WEB_SEARCH_ROUTE_UNAVAILABLE`.

Valid canonical route with no backend → `WEB_SEARCH_UNSUPPORTED`.

No provider fallback exists.

### Usage

```ts
export interface UsageCapability<TConfig> {
  readonly refreshPolicy?: UsageRefreshPolicy
  create(
    ctx: Context,
    config: TConfig,
    hooks: UsageCapabilityHooks,
  ): UsageSnapshotCollector
}
```

The provider owns source and normalization. The core owns generic collection, caching, invalidation, public projection and browser lifecycle.

A registered provider with no usage capability remains in the roster and receives an explicit synthetic `UNSUPPORTED` public usage state. It is not hidden and does not get a fake collector.

Registry changes reconcile usage registrations dynamically; a late provider can appear and a withdrawn provider disappears.

## Registration transaction

`registerProvider(ctx, descriptor, config)` performs:

1. canonical provider-id validation;
2. presentation-id validation;
3. canonical/deduplicated route validation;
4. provider-context construction of optional web-search and usage capabilities;
5. registry `record()`;
6. Cordis effect binding for registry withdrawal;
7. adapter construction/`ctx.llm.registerAdapter()` for model providers;
8. optional provider `install()`;
9. rollback of adapter + registry state if any later stage fails.

Rollback failures are aggregated with the original failure instead of hiding it.

## Core neutrality and fourth-provider proof

The production core contains no dependency on `nishi-dsh-codex`, `nishi-dsh-antigravity` or `nishi-dsh-claude`.

Core 10 added two protections:

- AST-based source/package boundary checks that ignore comments/JSDoc but catch direct provider-package/identity literals;
- an unfamiliar synthetic fourth provider (`nebula`) exercising registry lookup, route resolution, web-search capability, late usage registration, refresh and withdrawal without production-core edits.

That proves the core extension seam. It does **not** mean a shipping provider can appear in the Suite without adding its declarative package/bundle row.

## Project memory contract

Project Memory has one root policy for both context injection and tools:

- absolute session `cwd` required;
- walk to nearest `.git` marker (directory or worktree-style file);
- if no Git root exists, use normalized explicit `cwd`;
- context injection and `memory_read/write/edit` all use that discovered root.

Canonical memory paths reject symlink/junction path components and non-regular targets. Replacement writes use `@deepseek-ai/dsh-atomic-write` after those checks.

Maintenance commands register only when both `commands` and `llm` are injected. Their temporary model selection is cleaned after the maintenance turn.

## Provider-native memory policy

Project Memory is DSH-owned, but a provider whose primary vendor runtime injects its own persistent memory/project docs must suppress that behavior where possible.

Codex primary adds:

```text
memories.use_memories=false
memories.generate_memories=false
project_doc_max_bytes=0
```

Antigravity suppression remains partly configuration and partly prompt-level guidance; it must not be documented as a stronger enforcement guarantee than the vendor boundary provides.

## Authorization-id exception

The Model Accounts compatibility surface contains DSH credential/authorization ids such as `openai-codex`, `anthropic` and `openai`.

Those are **not Nishi provider ids** and are not model-routing branches. They belong to a constrained DSH compatibility surface that may read status and remove supported legacy grants; it does not start vendor OAuth through Nishi core.

Neutrality checks must distinguish this foreign id space from Nishi provider identities.

## Invariants

Current core invariants:

1. provider packages register through `registerProvider()` rather than directly registering LLM adapters;
2. core has no dependency on provider packages;
3. canonical provider ids/routes are validated before mutation;
4. model capability implies at least one route;
5. capability absence is legal;
6. browser identity comes from `ProviderPresentation` data;
7. web search uses exact current route with no fallback;
8. stale browser async work cannot resurrect withdrawn providers;
9. core source/package neutrality is regression-tested;
10. vendor-specific delegation registrations/tools are absent from the rc.3 architecture.

Provider-level repository-wide invariant consolidation remains part of the remaining rc.3 provider pass.

## Current implementation state

| Concern | State |
|---|---|
| Core package/lifecycle | **DONE / FROZEN** — Core 14 Final Acceptance PASS |
| Registry/registration/rollback | **DONE / FROZEN** |
| Canonical identity/routes | **DONE / FROZEN** |
| Routed web search contract | **DONE / FROZEN** |
| Usage domain/dynamic roster | **DONE / FROZEN** |
| Browser lifecycle/presentation | **DONE / FROZEN** |
| Core failure contract | **DONE**; provider-local failure classes/builders still need migration |
| Project Memory | **DONE / FROZEN** — PM02 Final Acceptance PASS |
| Codex provider | architecture landed; provider-local cleanup + live acceptance remain |
| Antigravity provider | architecture landed; catalog filter/tests + provider cleanup + live acceptance remain |
| Claude provider | usage-only architecture landed; provider cleanup/release acceptance remain |
| Cross-provider live switch | **OPEN** |
| Live dynamic-roster/browser acceptance | **OPEN** |
| Windows | **NOT TESTED** |

## Adding a provider

A new provider package supplies:

1. plugin `name`, `inject`, config/defaults and `apply()`;
2. `ProviderDescriptor` identity/presentation/executable;
3. only the capabilities it actually supports;
4. protocol translation for those capabilities;
5. Suite dependency + bundle row + release-family metadata;
6. provider tests and live smoke appropriate to the declared capabilities.

It must not require edits to core, project-memory, generic usage/web-search composition or browser identity logic.
