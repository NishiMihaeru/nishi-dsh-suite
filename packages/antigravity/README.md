# nishi-dsh-antigravity

Antigravity primary-provider plugin for Nishi DSH Suite, backed by the user's installed official `agy` CLI.

## Declared capabilities

- canonical provider id: `antigravity`;
- primary model route: `antigravity-cli`;
- native web-search backend: `agy search_web`;
- local usage visibility, with numeric quota remaining unsupported when no official machine-readable quota is available.

The distinction between provider id and route is intentional: `antigravity` is the provider identity, while `antigravity-cli` is the DSH model route retained for saved-session compatibility.

Vendor-specific delegation was removed in `0.1.0-rc.3`. Project Memory remains on the normal DSH primary plane and this package does not own or prefix its own memory implementation.

### Model catalog and reasoning efforts

The vendor names effort tiers inside the model id — `gemini-3.7-flash-low`, `-medium`, `-high`. This package presents such a family as one model, `gemini-3.7-flash`, advertising `low`/`medium`/`high` as reasoning efforts, and keeps the suffixed ids as aliases so saved sessions and existing configuration keep resolving. A model with only one suffixed variant is left as the vendor named it and advertises no efforts.

An invocation maps back to `--model <base> --effort <level>`; an effort in the request wins over the one an alias implies. A base id resolved without an explicit effort reports `high` as its default, which is a deliberate choice of the strongest tier rather than a vendor-stated default — name an effort on the route to get another. `docs/ARCHITECTURE.md` carries the reasoning and the allowlist consequence.

### Session-lived vendor process

A DSH step is no longer a whole `agy` process. The adapter keeps one live child per DSH session, keyed by `sessionId`, and drives it with `--input-format stream-json`, which runs one turn per NDJSON line. The opening request sends a `full` bridge envelope (system prompt, history, tool catalog); each later step sends a `delta` envelope carrying only what DSH appended since the last reply.

This exists for cost and for correctness. A fresh conversation per step could never hit the vendor's prefix cache — measured on real `agy 1.1.22`, a continuation inside one child read 20418 of a 23496-token prefix from cache — and it left the model reading its own past actions as JSON quoted back at it rather than as its own turns.

A live conversation is continued only by a request that extends exactly what it was already told, compared by a digest of each delivered message's id **and content** — DSH rewrites content while preserving ids, and such a rewrite has to reach the vendor as a rebuild. Divergent history, a changed system prompt, catalog, model or effort, and any call carrying a `purpose` (compaction, session titles) all get a fresh child instead. A delta omits the conversation's own replies, which the vendor already has. Reported usage is the difference from the previous turn, because `agy` counts a conversation rather than a turn.

`maxTokens` is accepted and ignored on a `purpose`-carrying auxiliary call, and still refused on an ordinary turn: `agy` has no output-cap flag, but refusing it everywhere left compaction — which always sends it — unable to run at all.

DSH mints its own tool-call ids rather than trusting the model's, which are freely authored and routinely repeated; the vendor's id is restored on the wire so the model still recognises its own call. `docs/ARCHITECTURE.md` carries the measurements and the full rebuild rules.

### Typed tool arguments

The forced structured-output schema is built per tool catalog: each call variant pins `name` to one tool and `arguments` to that tool's own declared schema. It previously declared `arguments: {"type": "object"}` for every call, which an empty object satisfies, so a call missing every required field was well-formed as far as the vendor was concerned.

An auxiliary call (`purpose` set: compaction, session titles) gets a schema with no `tool_calls` property at all, because compaction replays the conversation's tool catalog for cache alignment and the model answered it by calling a tool instead of summarizing.

DSH tool schemas are rewritten into the vendor's accepted subset first. Annotation-only keywords are dropped and `const` becomes a one-member `enum`; a schema using a composite keyword (`$ref`, `oneOf`, `allOf`, `if`) falls back to the untyped object for **that tool alone**, never for the catalog around it.

### Context capacity

The route advertises `contextWindowTokens` (default `200_000`). It is configured, not discovered: the vendor discloses no per-model window. Without any capacity `compaction-basic` refuses automatic pressure compaction and the refusal is swallowed as a single warning, so a session's history would grow with no bound and no visible symptom.

### Tool transport, and the one-time setup it needs

Two transports exist, selected by `transport`.

`mcp-bridge` is the **default**. DSH's tool catalog is handed to the vendor's own harness as MCP tools, so the model calls them natively; DSH still executes every call, through its own agent loop with its own permissions and durable history. This is the shape `nishi-dsh-codex` already uses for App Server dynamic tools.

It requires the bridge server to be registered with `agy` **once per machine**, and this package deliberately does not write your vendor configuration — the same boundary that keeps vendor authentication outside the suite:

```bash
agy mcp add dshtools node <install>/nishi-dsh-antigravity/lib/mcp-bridge-server.js
```

then add `"mcp(dshtools/*)"` to `userSettings.globalPermissionGrants.allow` in `~/.gemini/config/config.json`. `toolPermission` stays at its strict default, no trusted workspace is needed, and `--dangerously-skip-permissions` is never used. Until both are in place the first turn fails loudly, naming the exact command and the resolved path — it does not fall back on its own, because a route that silently hands the model no tools looks healthy and reads as a disobedient model.

A registered server is reachable by every `agy` session on the machine, which is the transport's one irreducible cost. It is narrowed rather than removed. Before spawning a vendor child the adapter mints a single-use token and hands it, with the socket path, to the child through its environment; measured against real `agy 1.1.22`, the vendor passes its environment to the MCP servers it launches verbatim -- 95 keys in, 95 keys out, nothing injected and nothing dropped. A server that presents no token, or one nobody registered, is served an empty catalog, so an unrelated `agy` session gets no tools.

That environment reaches **every** MCP server the vendor launches, third-party ones included -- a probe registered with no environment of its own still read a planted variable. The token is therefore readable by a co-resident server, and what keeps that from being a way in is that a token binds exactly once: the first claimant gets the channel and every later one is refused outright. An impostor that wins the race does not get served either -- the real server is refused instead and the turn fails loudly.

`transport: "schema"` selects the transport this package shipped with: `agy` stripped to a model endpoint and its reply forced through `--json-schema`. It needs no setup, and switching is a one-key config change in either direction. It remains the transport with the larger body of live evidence.

## Runtime boundary

The package owns Antigravity-specific protocol translation and process behavior. Shared registration, executable/runtime helpers, routed web-search dispatch and Usage & Limits projection live in `nishi-dsh-core`.

The package:

- uses the installed official `agy` executable rather than installing/managing it;
- does not copy Google/Antigravity credentials;
- never passes `--dangerously-skip-permissions`;
- does not register the model-facing `web_search` tool itself, only its native backend;
- does not bundle OpenAI/Anthropic vendor SDK runtimes.

Antigravity provider-policy status remains technically supported by the integration but policy-ambiguous; this package does not claim Google approval or Terms compliance.

## Core boundary

Provider registration goes through shared `registerProvider()`. Provider-neutral failure/runtime helpers and search routing belong to Core; vendor-specific `agy` request/response parsing and process semantics remain here.

Project Memory and DSH-native child-agent delegation are external to this provider package, so switching to or from `antigravity-cli` does not create a second memory/delegation plane.

## Current DSH declaration

The Antigravity manifest declares its provider-specific DSH peers at `0.1.2-alpha.1` (`dsh-invariants`, `dsh-llm`, `dsh-session`, `dsh-subprocess`, `dsh-timeout`).

`0.1.2-alpha.1` is the only supported DSH generation for this suite. Antigravity's own evidence for it is executable, not inherited: 99 unit tests plus 11 live scenarios (8 primary, 1 session continuation, 1 native search, 1 routed search) against the real `agy 1.1.22` binary, both on the alpha.1 baseline. Primary and session continuation were re-run on the current tree; the two search scenarios date from 2026-08-31 and are untouched by the changes since.

## Validation status — PENDING PROVIDER STAGE

Core and Project Memory are **THAWED, pending re-validation** (see `docs/HANDOFF.md`), not frozen. Antigravity is not frozen for rc.3 either, but its own provider-specific audit/cleanup and live acceptance are complete rather than queued behind Codex: catalog parsing was rewritten, every vendor-process diagnostic routes through `VendorFailure`, intra-package duplication was removed, and live acceptance passes (primary 8/8, native search 1/1, routed search 1/1). The only outstanding item is the freeze declaration itself (`docs/ROADMAP.md` §3), which needs the same independent validation the rest of the tree is waiting on.

Historical tests or live probes remain checkpoint-specific evidence only. The authoritative remaining work is maintained in `docs/ROADMAP.md` and the current operational task in `docs/HANDOFF.md`; this README intentionally describes the package boundary rather than duplicating that checklist.