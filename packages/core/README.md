# nishi-dsh-core

Provider-independent core for Nishi DSH Suite.

The core owns the seams that must stay stable when the primary provider changes: provider registration, shared vendor-runtime helpers, routed web search, normalized usage/limits, host RPC and browser surfaces. Provider protocol translation stays in provider packages.

A new provider must not require an edit to this package or to browser logic. Shipping it still requires normal declarative Suite packaging (dependency/bundle row/release-family membership).

## Entries and planes

| Entry | Plane | Mounted as | Owns |
|---|---|---|---|
| `nishi-dsh-core` | host | Suite bundle row | provider-registry publication plus host lifecycle composition |
| `nishi-dsh-core/web-search` | agent | Orchestrator preset row | routed `web_search` tool |
| `nishi-dsh-core/client` | browser | `dsh.client` manifest | Usage & Limits and Model Accounts UI |
| `nishi-dsh-core/runtime` | library | provider import | shared vendor CLI runtime and `registerProvider()` |
| `nishi-dsh-core/usage` | library | provider/core import | normalized usage contracts and collectors |

## Host lifecycle

The Cordis lifecycle is deliberately split in two:

1. outer `nishi-core` has `inject: []` and mounts `NishiProvidersService` first;
2. it then mounts the internal `nishi-core-host` child with `inject: ['nishiProviders', 'connection', 'credentials']`;
3. the child constructs Usage Limits host state and registers Usage Limits / Model Accounts RPC handlers.

This avoids the self-dependency that would result from asking the outer core to inject the `nishiProviders` service that it is responsible for publishing.

The Model Accounts host reads DSH credentials directly. The core does not import or inject `@deepseek-ai/dsh-authorization`.

### DSH Connection compatibility seam

Core RPC handlers depend only on `@deepseek-ai/dsh-client-connection`'s carrier-neutral `ConnectionRpcHandler` contract. Production source no longer imports `@deepseek-ai/dsh-host-apiproxy`.

The host registration seam covers the DSH Connection API transition:

- DSH `0.1.1-rc.2`: `rpc.handle(channel, handler, { authority: 'trusted-host' })`;
- DSH `0.1.2-alpha.1`: `rpc.handle(channel, handler)`, with Connection itself owning Host/Origin fencing plus browser authentication.

`registerConnectionRpcChannel()` isolates that transition. It preserves the rc.2 trusted-host argument when the installed handle exposes the legacy three-argument contract, and uses the authenticated two-argument form for alpha.1. Connection remains the lifecycle owner of the returned effect-scoped registration.

The browser entry is typed directly as Cordis `Context`, following the alpha.1 first-party client-plugin pattern. `@deepseek-ai/dsh-client-runtime` is no longer a production peer or explicit client injection. The package may keep rc.2-only retired packages in `devDependencies` while backward-compatibility tests still run on the installed rc.2 toolchain; dev dependencies do not form the published runtime boundary.

The remaining DSH peer version declarations are intentionally not broadened yet. Final supported-version ranges are reconciled only after source/runtime compatibility probes pass.

## Provider registry and registration

Providers declare `inject: ['nishiProviders', ...]` and call the shared `registerProvider(ctx, descriptor, config)` path.

`registerProvider()`:

- validates canonical provider and route identities;
- validates `presentation.id` against the provider id;
- validates/detaches an explicit `usage.refreshPolicy` before any capability factory or registry mutation;
- constructs provider-owned search and usage capabilities on the provider context;
- records the provider in `NishiProvidersService`;
- registers model routes through `ctx.llm.registerAdapter` when a model capability exists;
- runs provider-specific `install`;
- rolls back core-owned registry/adapter state transactionally if a later transaction stage fails.

Registry change listeners are non-vetoing observers. A synchronous observer exception or async observer rejection cannot turn an already committed registry change into a thrown `record()` call, cannot starve later observers, and cannot deny the caller its withdrawal handle. Descriptor data that may legitimately reject registration is validated before the commit instead.

The registry supports late registration and withdrawal. Usage composition follows registry changes instead of snapshotting a static provider list.

## Shared vendor CLI runtime (`./runtime`)

The runtime entry provides provider-neutral helpers including:

- executable resolution with explicit-config → environment override → `PATH` precedence;
- bounded UTF-8 line streaming;
- managed subprocess disposal;
- settled stderr collection;
- ephemeral agent workspaces;
- `VendorFailure` metadata and deterministic stderr recognition;
- shared provider-config validation;
- the single provider-registration path.

Raw vendor stderr is not automatically surfaced as a user-facing error message.

## Routed web search

`nishi-dsh-core/web-search` reads the current session request header on every call, validates the provider route with the same canonical-route contract used by registration, then resolves the backend through `ctx.nishiProviders.byRoute(route)?.webSearch`.

- malformed/unavailable route metadata → `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- valid canonical route with no backend → `WEB_SEARCH_UNSUPPORTED`;
- no fallback to another vendor.

The tool is an agent-plane preset row because search availability is a preset choice; the registry it resolves remains host-owned.

## Usage and browser surface

Usage is a descriptor capability. A provider may expose a collector or omit the capability entirely. The host/browser surface renders the current registry roster from serialized `ProviderPresentation` data rather than provider-specific browser branches.

A provider with no usage capability stays visible with an explicit `UNSUPPORTED` usage state. Late-mounted providers appear on roster refresh; withdrawn providers disappear. Browser refreshes are generation-aware so stale async work cannot resurrect removed providers.

## Provider-neutrality boundary

Production core code has no dependency on `nishi-dsh-codex`, `nishi-dsh-antigravity`, or `nishi-dsh-claude`. A synthetic fourth provider was exercised through registry, route lookup, web-search capability, late usage registration and withdrawal without production-core changes.

The only named vendor-like ids in the Model Accounts surface are DSH authorization/credential ids such as `openai-codex` and `anthropic`. They are a foreign DSH id space used by a constrained read/logout compatibility surface, not core provider-routing branches.

## Acceptance status

Core 14 remains the historical accepted baseline for DSH `0.1.1-rc.2`. Core 15 accepted the Connection/client compatibility migration against both installed rc.2 and official upstream `dsh-v0.1.2-alpha.1`.

Core remains **REOPENED** while integrity remediation is active. The registry-observer transaction correction described above is implemented and awaiting focused validation. Project Memory integrity work follows before the provider-independent foundation can be re-frozen. See `docs/ROADMAP.md`.
