# nishi-dsh-core

Provider-independent core for Nishi DSH Suite.

Core owns the seams that must stay stable when the primary provider changes: provider registration, shared vendor-runtime helpers, routed web search, normalized usage/limits, host RPC and browser surfaces. Provider protocol translation stays in provider packages.

## Entries and planes

| Entry | Plane | Owns |
|---|---|---|
| `nishi-dsh-core` | host | provider-registry publication and host lifecycle composition |
| `nishi-dsh-core/web-search` | agent | routed `web_search` tool |
| `nishi-dsh-core/client` | browser | Usage & Limits UI |
| `nishi-dsh-core/runtime` | library | shared vendor CLI runtime and `registerProvider()` |
| `nishi-dsh-core/usage` | library | normalized usage contracts and collectors |

A new provider must not require provider-specific branches in Core or browser identity logic. Shipping a provider can still require ordinary declarative Suite packaging changes.

## Host lifecycle

The Cordis lifecycle is split deliberately:

1. outer `nishi-core` publishes `NishiProvidersService`;
2. it mounts the internal `nishi-core-host` child with `inject: ['nishiProviders', 'connection', 'credentials']`;
3. that child constructs Usage Limits host state and registers the Usage Limits RPC handlers.

Core does not import or inject `@deepseek-ai/dsh-authorization`.

## Credentials

Core has no Model Accounts surface. It was removed together with the provider-declared `account` capability that fed it: the rows, the browser section, the host RPC handlers and the capability field are all gone rather than disabled, so no Core code path reads or mutates a vendor credential record any more.

Vendors that need a credential still own it entirely — sign-in happens in the vendor's own CLI or app, outside anything this suite brokers. That was already true for Antigravity, and is now true everywhere.

The safety property that mattered here outlives the feature. Core never had an atomic compare-and-delete for credential records, so destructive legacy-grant deletion was always fail-closed; with the mutation surface deleted there is no path that could race a read-kind-then-delete sequence at all. Do not reintroduce one without a reviewed atomic-safe credential contract.

## DSH Connection compatibility seam

Core RPC handlers depend on `@deepseek-ai/dsh-client-connection`'s carrier-neutral `ConnectionRpcHandler` contract.

The registration seam calls the one supported shape:

- DSH `0.1.2-alpha.1`: `rpc.handle(channel, handler)`.

`registerConnectionRpcChannel()` remains as a named seam, not because a second shape still exists — the rc.2 arity probe was removed with rc.2 support — but because it is the single place recording that Connection owns the returned disposer and Core must not add a second lifecycle owner.

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

Declared production DSH peers say exactly that:

```text
0.1.2-alpha.1
```

The devDependency graph matches. `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-host-apiproxy` were dropped entirely: both were retired before alpha.1, so their only purpose was proving compatibility with a generation this suite no longer supports. They must still stay absent from `dependencies` and `peerDependencies`, and production source must not import them — that invariant outlives the fixtures.

The alpha.1 side of the peer claim is accepted because the frozen Foundation was explicitly exercised against official `dsh-v0.1.2-alpha.1` at that commit; ordinary rc.2 workspace tests alone are not that evidence.

## Current status — THAWED, PENDING RE-VALIDATION

A follow-up audit changed this package after the acceptance recorded below: capability descriptors are validated before their factories run, the browser usage controller can no longer strand an in-flight refresh, and the disabled authorization mutation surface was removed rather than kept inert. That audit's Model Accounts state — registry-derived through a provider-declared `account` capability — was itself superseded shortly after: the whole Model Accounts surface was then removed outright, together with the `account` capability (see *Credentials* above), so no intermediate registry-derived state survives in the current tree. The accepted evidence below therefore describes a tree this one no longer matches, and must not be cited for the current implementation.

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
