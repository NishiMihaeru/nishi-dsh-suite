# Core Connector Contract

**Status:** design for `0.1.0-rc.3`. Supersedes the kit-era version of this document, which described a shared library (`nishi-dsh-provider-kit`) consumed by three sibling packages. Decisions of record are the maintainer's, 2026-08-27.

**Goal:** two kinds of package and nothing else.

- **One core plugin** owns everything that is provider-independent: the guarantee that project memory is the same on every provider, one routed `web_search` tool, one normalized usage/limits surface and its UI. It names no provider.
- **One plugin per provider** adapts a vendor CLI to the core's connector: a descriptor plus that vendor's protocol translation.

Adding a provider means adding a plugin. It touches no shared code, no host composition, and no browser file.

## Decisions of record (2026-08-27)

1. **Delegation is removed entirely.** Vendor subagents (`subagent_codex`, `subagent_antigravity`) go away with their tools, their runners and their memory transports. Delegation returns later through DSH's own child agents (`@deepseek-ai/dsh-subagent`'s spawn/fork backends), which ride the primary route and therefore inherit the core's tools and memory for free.
2. **The core is one package**, `nishi-dsh-core`, merging `provider-kit`, `usage-limits`, `usage-limits-host` and — once its provider-package dependency is inverted — `primary-web-search`. The web-search tool cannot merge before that inversion: it value-imports the provider packages, and the core cannot depend on what depends on it.
3. **Claude becomes a provider plugin** declaring only `usage`. This deliberately reverses stage 2.6 for Claude: that step folded two usage-source packages into the kit because two packages for one concept was overhead. The unit here is *one package per provider*, and a provider with a single declared capability is the honest demonstration that the connector holds.
4. **One canonical provider id, vendor route strings kept as aliases.** `id: 'codex'` with `routes: ['codex-app-server']`; `id: 'antigravity'` with `routes: ['antigravity-cli']`. The route string is user-visible — it appears in saved session request headers and in the profile default — so renaming it would be a breaking change for cosmetics on a seam DSH owns.
5. **Project memory stays its own package.** After delegation is removed it has zero provider coupling: `memory_read` / `memory_write` / `memory_edit` are ordinary DSH tools. The "same memory on every provider" guarantee comes from composition, not from merging two thousand lines of topic and filesystem code into the connector.

## Principles

1. **DSH owns the seams; the core is an on-ramp.** Model routing (`ctx.llm.registerAdapter`), tools and memory (`ctx.tools`, `ctx.projectMemory`), process lifetime (`ctx.subprocess`) are the harness's. This is also why the connector is cordis injection and not a plugin system of our own — see *Registration*.
2. **Absence is a declaration.** Every capability past identity is optional, and omitting one is a statement with defined consequences — never an oversight and never an error at composition time.
3. **A capability may only be declared where it can be enforced.** A capability the provider cannot actually deliver is worse than one it refuses.
4. **Translation stays provider-owned.** Roughly nine tenths of provider code is protocol translation, and the protocols differ in kind: JSON-RPC against an app-server versus bespoke JSON envelopes over a stream-json CLI. This contract deliberately does not try to unify them.
5. **Raw vendor output never escapes.** Only recognised conditions become diagnostics, built from the matched token alone.
6. **The core names no provider.** Grep-checkable, browser half included. Today this is violated in three client files; closing it is the point of the presentation record.

## Two planes, one package

The core has two mount points, because two lifetimes are involved and collapsing them breaks one of them.

| Entry | Plane | Mounted as | Owns |
|---|---|---|---|
| `nishi-dsh-core` | host | bundle row in `cordis.patch.yml` | provider registry, usage domain, usage RPC, browser half |
| `nishi-dsh-core/web-search` | agent | preset row | the `web_search` tool for the agents whose preset carries it |
| `nishi-dsh-core/runtime` | — | imported by provider packages | vendor CLI runtime and the registration contract |

`./runtime` is a library entry rather than a mount point. It exists so a provider package can take the shared runtime without importing the host graph and its browser-adjacent peer set.

The registry and the usage service are process singletons: a provider may only be registered once, and the browser reads one usage projection for every session. The `web_search` tool is per-agent by nature — whether an agent can search at all is a preset choice. The agent-plane entry resolves the host-plane registry rather than creating one.

The browser half cannot import provider packages, because those spawn processes. That is the reason provider identity must cross RPC as data.

## Registration — cordis injection, not a second plugin system

The core provides a service; each provider plugin injects it. cordis defers a plugin's `apply` until its injected services exist and unwinds the registration when the plugin is disposed, so load order, absence and teardown are already solved.

```ts
// core — host plane
export const name = 'nishi-core'
// provides: nishiProviders

// provider plugin
export const name = 'codex'
export const inject = ['nishiProviders', 'subprocess', 'llm']
export async function apply(ctx: Context, raw: Config = {}): Promise<void> {
  const config = resolveSharedProviderConfig('codex', raw, CODEX_DEFAULTS)
  await ctx.nishiProviders.register(codexDescriptor, config)
}
```

`register` records the descriptor, registers the model adapter under the descriptor's routes, registers the usage source with the usage domain, and runs `install`. A provider package contains **no** direct `ctx.llm.registerAdapter` call — a grep-checkable invariant, and the primary test of whether this contract is real.

A provider mounted after the browser has already rendered must appear; a provider not mounted at all must not leave a placeholder row. The usage roster is therefore derived from registrations, not from a static list.

## The descriptor

```ts
export interface ProviderDescriptor<TConfig extends SharedProviderConfig> {
  readonly id: string                              // canonical, one per provider: 'codex'
  readonly routes: readonly string[]               // model-route aliases: ['codex-app-server']
  readonly presentation: ProviderPresentation      // data; crosses RPC to the browser
  readonly executable: VendorExecutableDescriptor

  readonly model?: ModelCapability<TConfig>
  readonly usage?: UsageCapability
  readonly webSearch?: WebSearchCapability<TConfig>

  install?(ctx: Context, config: TConfig): void | Promise<void>
}
```

`routes` is empty exactly when `model` is absent — a usage-only provider such as Claude serves no route.

Two capabilities from the previous version are gone. `DelegationCapability` goes with delegation. `MemoryCapability` — with its `in-band-tool` / `loopback-mcp` / `prompt-prefix` transport matrix — goes because the only plane that needed a transport was the delegated one. On the primary plane memory tools execute inside DSH, identically for every provider, and a provider cannot opt out of them or affect them. That is the strongest form the guarantee can take, and it needs no declaration.

### Shared configuration

Six fields every subscription-CLI provider needs, with one schema, one merge, one validator: `env`, `modelCacheMs`, `catalogTimeoutMs`, `turnTimeoutMs`, `disposeGraceMs`, `stderrMaxBytes`. Rules: timers positive-finite and capped at `MAX_TIMER_DELAY_MS`, `modelCacheMs` non-negative, `stderrMaxBytes` positive. Provider-specific fields extend this; they never restate it.

### Executable

```ts
export interface VendorExecutableDescriptor {
  readonly id: string
  readonly defaultName: string        // 'codex', 'agy', 'claude'
  readonly envOverride: string        // DSH_<PROVIDER>_EXECUTABLE, uniformly
  readonly windowsName?: string       // defaults to `${defaultName}.exe`
  readonly productName?: string       // 'Codex CLI' — keeps shared diagnostics specific
}
```

Precedence: explicit config value, then the environment override, then `PATH`. Fails closed — an invalid override never silently selects a different binary. `productName` exists so a shared resolver can still say *which* product is missing.

### Model — the primary plane

```ts
export interface ModelCapability<TConfig> {
  create(ctx: Context, config: TConfig): LlmAdapter
}
```

Absent → the provider is not selectable as a primary. Routes come from the descriptor, not from the capability, because the registry needs them before the adapter is built.

**The model catalog must be honest.** No filtering of unrecognised model families. A hardcoded pattern such as `^(gemini|claude|gpt|oss)` silently hides new families, which attacks the exact value the product sells.

**Vendor-native memory must be suppressed on this plane.** A provider whose CLI carries its own memory or project-doc injection must disable it in the invocation it controls, at the same level of enforcement it claims. Codex does this with three `-c` overrides; Antigravity's is partly config and partly prompt instruction, which is guidance to a model rather than enforcement and must be recorded as such.

### Usage

```ts
export interface UsageCapability {
  read(): Promise<unknown>                                   // raw vendor payload
  normalize(payload: unknown, observedAtMs: number): ProviderUsageSnapshot
  readonly refreshPolicy?: UsageRefreshPolicy                // defaults to the shared default
  readonly capabilityClass: 'SUPPORTED_OFFICIAL' | 'UNSUPPORTED_NUMERIC_USAGE' | string
}
```

Absent, or declared unsupported → the UI shows an honest row, never an error. One source interface, one method, one collector, one default policy; registration iterates descriptors rather than branching per provider.

### Web search

```ts
export interface WebSearchCapability<TConfig> {
  create(ctx: Context, config: TConfig): WebSearchBackend
}

export interface WebSearchBackend {
  search(route: WebSearchRoute, request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult>
}
```

Absent → routing to this provider yields an explicit unsupported error. The core owns the tool, route resolution from the calling agent's request header, the error taxonomy and result normalization; the provider owns argv construction, event parsing and result extraction. There is no DeepSeek/Exa/Perplexity fallback by design.

### Presentation record

```ts
/** Serializable. Crosses RPC. No functions, no imports from provider packages. */
export interface ProviderPresentation {
  readonly id: string                    // matches descriptor.id
  readonly displayName: string           // 'Codex'
  readonly brandColor: string            // '#10A37F'
  readonly iconPath?: string             // single SVG path in a 24x24 viewBox
  readonly groupLabel?: string           // when one account spans vendors, e.g. 'Claude/GPT'
}
```

`iconPath` is a path string rather than a component so it can be sent as data; a provider supplying none renders the neutral mark, which must remain a supported outcome rather than a visual bug. `groupLabel` replaces the substring guessing that currently decides grouping from the words `'claude'`, `'gpt'` and `'external'` found in a window label.

## Invariants

Checkable, and each one is a test rather than a review habit.

1. No provider package calls `ctx.llm.registerAdapter` or registers a usage source directly.
2. `nishi-dsh-core` contains no provider identifier — `codex`, `antigravity`, `claude`, `gpt`, `gemini` — in any file, browser half included. Vendor-neutral words in prose comments are the only exception, and the test spells out which.
3. Every descriptor with a `model` capability declares at least one route; every descriptor without one declares none.
4. `nishi-dsh-core` does not depend on any provider package.
5. No `subagents` registration and no vendor subagent tool exists anywhere in the tree.

## Adding a provider

Complete list. Anything outside it is a contract defect, not a task.

1. A package exporting `name`, `inject` (including `nishiProviders`), `Config`, and an `apply` that resolves the shared config and calls `ctx.nishiProviders.register`.
2. A descriptor: identity, routes, presentation, executable, and the capabilities the vendor actually supports.
3. Protocol translation: the `LlmAdapter`, the search backend, the usage source — whatever the declared capabilities require.
4. A bundle row in `packages/suite/cordis.patch.yml`, and membership in the release family lists.

No edits to the core, the usage domain, the host composition, or any browser file.

## Implementation state

Measured at `0.1.0-rc.3` in-repo, after Tasks 0–12 of `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md`.

| Concern | State |
|---|---|
| Core package | done — `nishi-dsh-core` merges the former kit, usage domain, usage host and web-search tool; entries `.`, `./runtime`, `./usage`, `./web-search`, `./client` |
| Registry and connector | done — `ctx.nishiProviders`; providers declare `inject: ['nishiProviders', ...]`; duplicate id and duplicate route both refused; withdrawal bound to the provider plugin's lifetime |
| Delegation | removed in full, including both memory transports and the two preset tools |
| Executable resolution, stream decoding, disposal, settled stderr, ephemeral workspaces | one implementation each |
| Model plane | one adapter per provider, registered only through `registerProvider` |
| Web search | contract and tool in the core, resolved by route through the registry; backends provider-owned; the core imports no provider package |
| Usage | capability on the descriptor; the host reconciles its roster against registrations; normalizers and sources live with their providers |
| Presentation record | done — identity crosses RPC as data; the browser's Usage & Limits half names no provider; neutral mark and neutral accent are supported outcomes |
| Dynamic roster | done — derived from registrations; late mount appears, absent provider leaves no row |
| Claude | a provider plugin declaring `usage` alone |
| Failure shape | **open** — the core has `VendorFailure`; providers still build the same string themselves (Task 13) |
| Copied helpers | **open** — `record`, `thrown`, `assertPositiveFinite`, `bounded` still have several copies (Task 13) |
| Model catalog honesty | **open** — Antigravity still filters model families by pattern (Task 14) |
| Grep-checkable invariants | **open** — written as prose here, not yet enforced by a test (Task 15) |
| Live acceptance of rc.3 | **open** (Task 16) |

### Documented exception to "the core names no provider"

`packages/core/src/host/authorization-rpc.ts` and the Model Accounts client surface name `openai-codex`, `anthropic` and `openai`. These are **DSH authorization provider ids** — a foreign id space the core reads from the harness — and the list is a security control rather than a provider branch: those ids may be read, none may start OAuth, and only legacy grants may be removed. Task 15's neutrality test must name this exception explicitly and assert it stays read/logout-only, so the carve-out cannot grow into provider branching.
