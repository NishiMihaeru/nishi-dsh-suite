# nishi-dsh-core

Provider-independent core for Nishi DSH Suite.

Core owns the seams that must stay stable when the primary provider changes: provider registration, shared vendor-runtime helpers, routed web search, normalized usage/limits, host RPC and browser surfaces. Provider protocol translation stays in provider packages.

## Entries and planes

| Entry | Plane | Owns |
|---|---|---|
| `nishi-dsh-core` | host | provider-registry publication and host lifecycle composition |
| `nishi-dsh-core/web-search` | agent | routed `web_search` tool |
| `nishi-dsh-core/client` | browser | Usage & Limits and Model Accounts UI |
| `nishi-dsh-core/runtime` | library | shared vendor CLI runtime and `registerProvider()` |
| `nishi-dsh-core/usage` | library | normalized usage contracts and collectors |

A new provider must not require provider-specific branches in Core or browser identity logic. Shipping a provider can still require normal declarative Suite packaging changes.

## Host lifecycle

The Cordis lifecycle is split deliberately:

1. outer `nishi-core` publishes `NishiProvidersService`;
2. it mounts the internal `nishi-core-host` child with `inject: ['nishiProviders', 'connection', 'credentials']`;
3. that child constructs Usage Limits host state and registers Usage Limits / Model Accounts RPC handlers.

Core does not import or inject `@deepseek-ai/dsh-authorization`.

### Model Accounts and credentials

Credential-store availability is distinct from ordinary credential absence. A failed status read projects a sanitized `ERROR` state; credential material and backend error text do not cross the browser RPC boundary.

Direct subscription OAuth initiation is disabled. Legacy DSH grants may still be detected for compatibility, but in-app destructive legacy-grant deletion is also disabled. DSH `0.1.2-alpha.1` exposes serialized credential read/modify/write and unconditional delete operations, but no atomic compare-and-delete operation that can prove the record being removed is still the previously observed grant. A separate read-kind-then-delete sequence can erase a newer API-key record written by another process, so Core fails closed instead of performing that race-prone mutation. The browser therefore shows legacy grants as informational state and does not render an in-app Sign Out action for them.

### DSH Connection compatibility seam

Core RPC handlers depend only on `@deepseek-ai/dsh-client-connection`'s carrier-neutral `ConnectionRpcHandler` contract.

The registration seam currently supports the two declared peer generations:

- DSH `0.1.1-rc.2`: `rpc.handle(channel, handler, { authority: 'trusted-host' })`;
- DSH `0.1.2-alpha.1`: `rpc.handle(channel, handler)`.

`registerConnectionRpcChannel()` isolates this transition. The current `Function.length` compatibility probe is intentionally retained while rc.2 remains a supported published peer; removing it is a future compatibility-boundary decision, not part of the alpha.1 correctness fixes.

## Provider registry and registration

Providers declare `inject: ['nishiProviders', ...]` and call shared `registerProvider(ctx, descriptor, config)`.

`registerProvider()` validates identity/routes/presentation, constructs optional capabilities on the provider context, records the provider, registers model routes through `ctx.llm.registerAdapter`, runs provider install hooks, and rolls core-owned state back if a later transaction stage fails.

Registry observers are non-vetoing. Provider registration and withdrawal drive the live usage roster.

## Shared vendor CLI runtime

`./runtime` provides provider-neutral helpers including executable resolution, bounded UTF-8 line streaming, managed subprocess disposal, settled stderr collection, ephemeral workspaces, `VendorFailure` metadata/recognizers, shared config validation, and the single provider-registration path.

Raw vendor stderr is not automatically surfaced as a user-facing error message.

## Routed web search

`nishi-dsh-core/web-search` reads the current session request header on every call and resolves exactly the current route through `ctx.nishiProviders.byRoute(route)?.webSearch`.

- malformed/unavailable route -> `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- valid route with no backend -> `WEB_SEARCH_UNSUPPORTED`;
- no fallback to another vendor.

## Usage and browser surface

Usage is an optional provider descriptor capability. A provider without one remains visible with explicit `UNSUPPORTED` state.

Core owns generic caching and invalidation. `UsageCapabilityHooks.invalidate()` is an authoritative observation-generation boundary: it immediately drops the provider's cached snapshot, marks any already-running refresh generation as superseded for cache publication, and prevents cached read APIs from returning invalidated data. A refresh that began before invalidation may still resolve to its original caller, but it cannot repopulate the cache after that invalidation. A subsequent refresh is not forced to join the superseded in-flight generation.

The browser's `get-providers` response is likewise authoritative for the current roster. If a provider is omitted because its host snapshot was invalidated, the browser clears any prior locally `FRESH` copy so the next `ensureFresh` path can refresh it. There is no separate push channel for provider invalidation; the contract is that the next host/cache read cannot serve the vendor-superseded snapshot.

Browser refreshes remain roster-generation-aware so stale async work cannot resurrect withdrawn/re-registered provider generations.

## Supported DSH peer family

Production DSH peers remain intentionally restricted to:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The local package devDependency graph is still pinned to the reproducible rc.2 development baseline. Compatibility claims for the changed code must therefore be re-exercised explicitly against official `dsh-v0.1.2-alpha.1` at commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`; a normal rc.2 local test run alone is not alpha.1 evidence.

## Current status — REOPENED / PENDING VERIFICATION

A fresh independent audit against exact DSH `0.1.2-alpha.1` reopened Core and found:

- a credential read-check-delete TOCTOU in legacy logout;
- usage invalidation that did not actually drop cached snapshots and could leave a browser-side `FRESH` copy suppressing refresh.

The current branch implements fail-closed legacy-grant handling plus generation-aware authoritative usage invalidation and adds targeted regression coverage. These changes have been statically reviewed against the upstream alpha.1 contracts, but the changed tree has **not yet received the new executable Gemini/local validation run**.

Historical PASS evidence remains historical evidence for its exact earlier checkpoint only. Do not treat it as validation of the current branch head.

Windows remains **NOT TESTED**.
