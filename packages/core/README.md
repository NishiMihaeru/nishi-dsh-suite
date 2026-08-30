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

A new provider must not require provider-specific branches in Core or browser identity logic. Shipping a provider can still require ordinary declarative Suite packaging changes.

## Host lifecycle

The Cordis lifecycle is split deliberately:

1. outer `nishi-core` publishes `NishiProvidersService`;
2. it mounts the internal `nishi-core-host` child with `inject: ['nishiProviders', 'connection', 'credentials']`;
3. that child constructs Usage Limits host state and registers Usage Limits / Model Accounts RPC handlers.

Core does not import or inject `@deepseek-ai/dsh-authorization`.

## Model Accounts and credentials

Rows are registry-derived. A provider declares an optional `account` capability — credential scope, credential id, label — and Core renders one row per live provider that declares one. Core names no vendor, holds no label table and owns no credential namespace; a provider that declares nothing simply has no row. Row identity is the canonical provider id, and the credential key is assembled from the provider's own declaration rather than a scope fixed in Core.

`account` is declarative data only: no factory, no secret, nothing executable. It is validated at registration before any Core state is mutated.

Credential-store availability is distinct from ordinary credential absence. A failed status read projects a sanitized `ERROR` state; credential material and backend error text do not cross the browser RPC boundary.

Direct subscription OAuth initiation is disabled, and the surface that expressed it no longer exists: no begin/submit/cancel/logout endpoints, no client state machine, and no secret-typed prompt channel. A disabled mutation path that still accepts a secret is a liability rather than compatibility, so it was removed instead of left inert.

Legacy DSH grants may still be detected for compatibility, but in-app destructive legacy-grant deletion is disabled. DSH `0.1.2-alpha.1` exposes credential read/modify/write plus unconditional delete operations, but no atomic compare-and-delete operation proving the record being removed is still the previously observed grant. A separate read-kind-then-delete sequence can erase a newer API-key record written by another process, so Core fails closed instead. The browser shows legacy grants as informational state and does not render an in-app destructive Sign Out action.

## DSH Connection compatibility seam

Core RPC handlers depend on `@deepseek-ai/dsh-client-connection`'s carrier-neutral `ConnectionRpcHandler` contract.

The registration seam still accepts both shapes:

- DSH `0.1.1-rc.2`: `rpc.handle(channel, handler, { authority: 'trusted-host' })`;
- DSH `0.1.2-alpha.1`: `rpc.handle(channel, handler)`.

`registerConnectionRpcChannel()` isolates this transition. Only `0.1.2-alpha.1` is supported, so the `Function.length` probe is removal debt rather than retained compatibility: it survives until the declared peer range is narrowed, and it must be removed in that same change.

## Provider registry and registration

Providers declare `inject: ['nishiProviders', ...]` and call shared `registerProvider(ctx, descriptor, config)`.

`registerProvider()` validates identity/routes/presentation, constructs optional capabilities on the provider context, records the provider, registers model routes through `ctx.llm.registerAdapter`, runs provider install hooks, and rolls Core-owned state back if a later transaction stage fails.

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

Core owns generic caching and invalidation. `UsageCapabilityHooks.invalidate()` is an authoritative observation-generation boundary: it immediately drops the provider's cached snapshot, advances the invalidation generation, and prevents cached read APIs from returning invalidated data. Refresh work that began before invalidation may still resolve to its original caller, but it cannot repopulate the cache after that invalidation. A subsequent refresh does not have to join the superseded in-flight generation.

The browser's `get-providers` response is authoritative. If a provider is omitted because its host snapshot was invalidated, the browser clears any prior locally `FRESH` copy so the next `ensureFresh()` path can refresh it. There is no separate push channel for invalidation; the guarantee is that the next authoritative host/cache read cannot serve the vendor-superseded snapshot.

Browser refreshes remain roster-generation-aware so stale async work cannot resurrect withdrawn/re-registered provider generations.

## Supported DSH peer family

The only supported DSH generation is `0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`). `0.1.1-rc.2` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence.

Declared production DSH peers are still wider than that:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Upstream has not published `0.1.2-alpha.1` to npm, so an alpha.1-only range would be uninstallable and the package devDependency graph stays pinned to the reproducible rc.2 development baseline. Narrowing the range is a published-contract change with its own gate; see the repository `docs/README.md`.

The alpha.1 side of the peer claim is accepted because the frozen Foundation was explicitly exercised against official `dsh-v0.1.2-alpha.1` at that commit; ordinary rc.2 workspace tests alone are not that evidence.

## Current status — THAWED, PENDING RE-VALIDATION

A follow-up audit changed this package after the acceptance recorded below: capability descriptors are validated before their factories run, the browser usage controller can no longer strand an in-flight refresh, Model Accounts became registry-derived through a provider-declared `account` capability, and the disabled authorization mutation surface was removed rather than kept inert. The accepted evidence below therefore describes a tree this one no longer matches, and must not be cited for the current implementation.

Superseded accepted Foundation implementation:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw follow-up PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Core evidence records:

- focused tests `182/182` PASS;
- Core check/build PASS;
- full workspace test/check/build and `pnpm verify:local` PASS;
- disposable exact-commit alpha.1 Connection RPC registration PASS;
- authorization status and fail-closed legacy logout PASS with no credential deletion;
- Usage invalidation/cache-drop runtime probe PASS;
- independent follow-up review found no new blocking Core/Foundation defect.

Provider-specific compatibility still requires provider-specific validation; Codex is the next active stage.

Windows remains **NOT TESTED**.
