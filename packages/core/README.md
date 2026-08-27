# nishi-dsh-core

The provider-independent core of Nishi DSH Suite.

Everything in this package is true for every provider, and nothing in it names one. Providers are separate plugins that reach the core through cordis injection and contribute a descriptor plus their own protocol translation — so adding a provider is adding a plugin, and touches nothing here.

## Two mount points

| Entry | Plane | Mounted as | Owns |
|---|---|---|---|
| `nishi-dsh-core` | host | bundle row | the provider registry, the usage/limits service, its RPC projection |
| `nishi-dsh-core/web-search` | agent | preset row | the routed `web_search` tool |
| `nishi-dsh-core/client` | browser | `dsh.client` manifest | Usage & Limits and Model Accounts UI |
| `nishi-dsh-core/runtime` | library | imported by provider packages | shared vendor CLI runtime and the registration contract |

The registry and usage service are process singletons: a provider may register only once, and the browser reads one usage projection for every session.

## Shared vendor CLI runtime (`./runtime`)

- `resolveVendorExecutable(descriptor, options)` — the single executable resolver. Precedence: explicit config value, then the provider's `envOverride` environment variable, then a `PATH` walk. Fails closed with a diagnostic that names the product; never silently falls back past an invalid explicit value.
- `outputLines(stream, maxBytes)` — bounded newline-delimited decoding of a Node `Readable`. CRLF-tolerant, rejects an over-long line instead of buffering without limit, and yields a trailing partial line once the stream ends.
- `disposeVendorChild(handle)` — terminate the managed subprocess tree, wait for exit, await settlement.
- `settledStderr(handle, graceMs)` — vendor CLIs commonly explain themselves on stderr *after* the terminal protocol frame, so reading it the instant that frame arrives sees an empty buffer.
- `ephemeralAgentWorkspace(spec)` — the temporary `<tmp>/.agents/agents/<name>/agent.md` tree as one unit, with a `dispose()` that removes it even when creation failed partway.
- `vendorFailure(spec)` / `recognizeVendorStderr(text, recognizers)` — one error shape carrying `product` / `stage` / `category`. Raw vendor stderr never reaches a message: only conditions a caller explicitly recognized become part of a diagnostic.
- `resolveSharedProviderConfig(id, raw, defaults)` and `registerProvider(ctx, descriptor, config)` — the merge-and-validate step for the six config fields every provider shares, and the single registration path.

## Routed web search

One `web_search` tool, resolved per call through the provider registry: the session's primary route decides which provider's native search runs. A provider that declares no search capability, or a route no provider serves, produces an explicit `WEB_SEARCH_UNSUPPORTED` error — there is deliberately no DeepSeek/Exa/Perplexity fallback, because silently searching with a different vendor than the session selected is worse than saying no.

It is a preset row rather than a bundle row: whether an agent can search at all is a preset choice, while the registry it resolves is a host-plane singleton.

## Usage and limits

One normalized domain with a capability taxonomy in which "this provider exposes no machine-readable usage" is a legal state rather than an error, one collector shape, and one default refresh policy. The browser is served a safe projection over RPC; no vendor OAuth, session, or token material crosses that boundary.

## Provenance

This package is the merge of the former `nishi-dsh-provider-kit`, `nishi-dsh-usage-limits`, `nishi-dsh-usage-limits-host`, and `nishi-dsh-primary-web-search` — four packages describing one core. The web-search tool could only join once it stopped importing the provider packages: it now resolves backends through the registry.
