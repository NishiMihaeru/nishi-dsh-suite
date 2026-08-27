# Provider Contract

**Status:** design. Partially implemented — see *Implementation state* at the end.

**Goal:** one contract every subscription provider satisfies, present and future. Adding a provider costs a descriptor plus its protocol translation, and touches no shared code — not the host wiring, not the usage domain, not the browser UI.

## Principles

1. **DSH owns the seams; the Suite is an on-ramp.** Model routing (`ctx.llm.registerAdapter`), tools and memory (`ctx.tools`, `ctx.projectMemory`), process lifetime (`ctx.subprocess`), delegation (`ctx.subagents`) are the harness's. The contract describes how a vendor CLI reaches them, never a parallel harness.
2. **Absence is a declaration.** Every capability past identity is optional, and omitting one is a statement with defined consequences — never an oversight and never an error at composition time.
3. **A capability may only be declared where it can be enforced.** Both current providers declare `NO_START_CAPABILITIES`, which is honest. Antigravity's managed agent tool list is *not* honoured by its CLI — a live session announces the full native toolset — so its `toolFilter` must stay `false`. A capability the service cannot enforce is worse than one it refuses.
4. **Translation stays provider-owned.** Roughly nine tenths of provider code is protocol translation — Codex `adapter.ts` 837 + `wire.ts` 802, Antigravity `antigravity-primary.ts` 784. The protocols differ in kind: JSON-RPC against an app-server versus bespoke JSON envelopes over a stream-json CLI. This contract deliberately does not try to unify them.
5. **Raw vendor output never escapes.** Only recognised conditions become diagnostics, built from the matched token alone. This holds for every capability.

## Two halves

The contract splits along the process boundary, because the Usage & Limits client runs in the browser and cannot import a package that spawns processes.

- **Host descriptor** — code. Adapters, sources, spawn specs. Lives in the provider package, consumed by the kit.
- **Presentation record** — data. Crosses RPC to the browser as part of the usage projection.

Today the browser hardcodes provider identity in three places: `client/roster.ts` (id and display name), `client/ui/ProviderLogo.tsx` (brand colour and an inline SVG per id, unknown ids falling back to grey with no mark), and `client/usage-group-model.ts:71` (group naming by substring match on `'claude'`/`'gpt'`/`'external'`). A future provider is invisible in the UI until someone edits browser code. The presentation record exists to end that.

```ts
/** Serializable. Crosses RPC. No functions, no imports from provider packages. */
export interface ProviderPresentation {
  readonly id: string                    // 'codex', 'antigravity', ...
  readonly displayName: string           // 'Codex'
  readonly brandColor: string            // '#10A37F'
  readonly iconPath?: string             // single SVG path in a 24x24 viewBox
  readonly groupLabel?: string           // when one account spans vendors, e.g. 'Claude/GPT'
}
```

`iconPath` is a path string rather than a component so it can be sent as data; a provider that supplies none renders the neutral mark, which must remain a supported outcome rather than a visual bug.

## Host descriptor

```ts
export interface ProviderDescriptor<TConfig extends SharedProviderConfig> {
  readonly id: string
  readonly presentation: ProviderPresentation
  readonly executable: VendorExecutableDescriptor

  readonly model?: ModelCapability<TConfig>
  readonly delegation?: DelegationCapability<TConfig>
  readonly memory?: MemoryCapability
  readonly usage?: UsageCapability
  readonly webSearch?: WebSearchCapability<TConfig>

  install?(ctx: Context, config: TConfig): void | Promise<void>
}
```

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

Precedence: explicit config value, then the environment override, then `PATH`. Fails closed — an invalid override never silently selects a different binary. `productName` exists so a shared resolver can still say *which* product is missing; without it every provider reports the same unhelpful sentence, which is what previously drove a provider to keep its own resolver just to own its wording.

### Model — the primary plane

```ts
export interface ModelCapability<TConfig> {
  readonly routes: readonly string[]
  create(ctx: Context, config: TConfig): LlmAdapter
}
```

Absent → the provider is not selectable as a primary. This is the capability that makes providers interchangeable, and it is DSH's own contract: `LlmAdapter.stream(GenerateOptions)` plus `listModels()`.

**The model catalog must be honest.** No filtering of unrecognised model families. A hardcoded pattern such as `^(gemini|claude|gpt|oss)` silently hides new families, which attacks the exact value the product sells.

### Delegation — the subagent plane

```ts
export interface DelegationCapability<TConfig> {
  readonly capabilities: SubagentCapabilities   // outputSchema, depthLimit, toolFilter, persona
  create(ctx: Context, config: TConfig): SubagentProvider
}
```

Absent → the provider cannot be delegated to; only its models are usable. Declared capabilities are validated by DSH against each start request, so a false declaration produces a refusal rather than silent best-effort.

Delegation is deliberately **not** normalised across providers beyond this: a delegated vendor agent brings its own tools, sandbox and audit trail, and flattening that removes the reason to call it. DSH's own in-process child agents (`@deepseek-ai/dsh-subagent`'s `child-agent`) are the uniform path when uniformity is what is wanted.

### Memory

Project memory is provider-agnostic on the primary plane — the tools execute inside DSH. On the **delegated** plane it must physically reach the vendor process, and the observed transports differ in kind:

| Transport | Mechanism | Seen in |
|---|---|---|
| `in-band-tool` | host-declared tool in the turn params with an in-band callback | Codex app-server `dynamicTools` |
| `loopback-mcp` | ephemeral authenticated HTTP MCP server on `127.0.0.1` | the former Claude integration |
| `prompt-prefix` | rendered bootstrap injected ahead of the task | Antigravity |

```ts
export interface MemoryCapability {
  readonly transport: 'in-band-tool' | 'loopback-mcp' | 'prompt-prefix'
  readonly access: 'read'            // write is intentionally not offered to delegated runs
}
```

`in-band-tool` is strictly the best where available: no listener, no secret, no vendor config mutation, and the tool's lifetime equals the turn's. `loopback-mcp` is the fallback for CLIs with no in-band channel. `prompt-prefix` is the weakest — the model cannot fetch a topic it was not handed — and a provider declaring it should be understood as offering degraded memory, not equivalent memory.

Delegated runs are **read-only** by decision. Writing would require ownership and conflict rules across concurrent runs; the maintenance/consolidation turn is where that would belong if it is ever wanted.

The adaptation itself — deriving a subagent memory handle from `ctx.projectMemory` — is identical across providers and belongs to the kit, not to each package.

### Usage

```ts
export interface UsageCapability {
  read(): Promise<unknown>                                   // raw vendor payload
  normalize(payload: unknown, observedAtMs: number): ProviderUsageSnapshot
  readonly refreshPolicy?: UsageRefreshPolicy                // defaults to the shared default
  readonly capabilityClass: 'SUPPORTED_OFFICIAL' | 'UNSUPPORTED_NUMERIC_USAGE' | string
}
```

Absent, or declared unsupported → the UI shows an honest row, never an error. The usage domain already proves this with `NO_SUPPORTED_MACHINE_READABLE_SOURCE`; the contract generalises it. One source interface, one method, one collector, one default policy — registration iterates descriptors rather than branching per provider.

### Web search

```ts
export interface WebSearchCapability<TConfig> {
  create(ctx: Context, config: TConfig): WebSearchBackend
}

export interface WebSearchBackend {
  search(route: WebSearchRoute, request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult>
}
```

Absent → routing to this provider yields an explicit unsupported error, which is the existing behaviour and correct. The two current backends already share their shape — an error class carrying a code, `record`, `bounded`, `promptFor`, effort encoding, and `search(route, request, signal)`; the contract and helpers are shared, while argv construction, event parsing and result extraction stay provider-owned.

## Registration — the single path

```ts
export async function registerProvider<TConfig extends SharedProviderConfig>(
  ctx: Context, descriptor: ProviderDescriptor<TConfig>, config: TConfig,
): Promise<void>
```

Order: delegation, then model, then `install`. A provider package must contain **no** direct `ctx.subagents.registerProvider` or `ctx.llm.registerAdapter` call — that is a grep-checkable invariant, and the primary test of whether this contract is real.

## Adding a provider

Complete list. Anything outside it is a contract defect, not a task.

1. A package exporting `name`, `inject`, `Config`, `apply` — where `apply` resolves the shared config and calls `registerProvider`.
2. A descriptor: identity, presentation, executable, and the capabilities the vendor actually supports.
3. Protocol translation: the `LlmAdapter`, the subagent runner, the search backend — whatever the declared capabilities require.
4. Registration as a bundle row in `packages/suite/cordis.patch.yml`, and membership in the release family lists.

No edits to the usage domain, the host composition, or any browser file.

## Implementation state

| Concern | State |
|---|---|
| Executable resolution | one implementation, `productName` for specific diagnostics |
| Stream decoding, disposal, settled stderr, ephemeral workspaces | one implementation each |
| Usage: source interface, collector, refresh policy, registration | unified; one `read()`, one collector, descriptor-driven |
| Failure shape | kit has `VendorFailure`; Codex and Antigravity still produce the same string themselves |
| Shared config and single registration path | in progress |
| Memory adaptation | duplicated verbatim between Codex and Antigravity |
| Web search contract | shape parallel, not yet unified |
| Presentation record | not built; the browser still hardcodes three providers |
| Model catalog honesty | Antigravity still filters by pattern |
