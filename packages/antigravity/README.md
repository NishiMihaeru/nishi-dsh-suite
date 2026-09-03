# nishi-dsh-antigravity

Antigravity primary-provider plugin for Nishi DSH Suite, backed by the user's installed official `agy` CLI.

## Declared capabilities

- canonical provider id: `antigravity`;
- primary model route: `antigravity-cli`;
- native web-search backend: `agy search_web`;
- local usage visibility, harvested from this package's own `agy` child.

### Where quota comes from, and what it cannot see

The vendor publishes no machine-readable quota surface: not a command, not a
flag, not a file. The only one that exists is a private RPC of its language
server. This route reads that RPC on exactly one process — the `agy` child it
spawned for a turn — resolving its loopback ports from that pid alone, and
caches the reading for the usage collector. The call carries no credential:
loopback, `Content-Type` and `Connect-Protocol-Version`, nothing else.

It used to reach further: scanning every process on the machine for something
Antigravity-shaped and lifting a `--csrf_token` out of its command line. That
was removed on 2026-09-03. It contradicted this package's own posture that it
reads no credential or token store, and both independent reviewers ranked
removing it their second-highest simplification.

The cost is stated rather than hidden. **There is no quota figure until this
plugin has run a turn**, and the figure never reflects what the Antigravity IDE
or desktop app consumed. When there is no reading the collector reports an
honest unsupported row rather than an error or a fabricated number.

The distinction between provider id and route is intentional: `antigravity` is the provider identity, while `antigravity-cli` is the DSH model route retained for saved-session compatibility.

Vendor-specific delegation was removed in `0.1.0-rc.3`. Project Memory remains on the normal DSH primary plane and this package does not own or prefix its own memory implementation.

### Model catalog and reasoning efforts

The vendor names effort tiers inside the model id — `gemini-3.7-flash-low`, `-medium`, `-high`. This package presents such a family as one model, `gemini-3.7-flash`, advertising `low`/`medium`/`high` as reasoning efforts, and keeps the suffixed ids as aliases so saved sessions and existing configuration keep resolving. A model with only one suffixed variant is left as the vendor named it and advertises no efforts.

An invocation maps back to `--model <base> --effort <level>`; an effort in the request wins over the one an alias implies. A base id resolved without an explicit effort reports `high` as its default, which is a deliberate choice of the strongest tier rather than a vendor-stated default — name an effort on the route to get another. `docs/ARCHITECTURE.md` carries the reasoning and the allowlist consequence.

### Session-lived vendor process

A DSH step is no longer a whole `agy` process. The adapter keeps one live child per DSH session, keyed by `sessionId`, and drives it with `--input-format stream-json`, which runs one turn per NDJSON line. The opening request sends a `full` bridge envelope (system prompt, history, tool catalog); each later step sends a `delta` envelope carrying only what DSH appended since the last reply.

This exists for cost and for correctness. A fresh conversation per step could never hit the vendor's prefix cache — measured on real `agy 1.1.22`, a continuation inside one child read 20418 of a 23496-token prefix from cache — and it left the model reading its own past actions as JSON quoted back at it rather than as its own turns.

A live conversation is continued only by a request that extends exactly what it was already told, compared by a digest of **everything sent for each delivered message** — its id, role, source and content. Id alone is not enough because DSH rewrites content while preserving ids, and content alone is not enough because `source` is on the wire too and decides whether an assistant message is withheld from a delta. Any such rewrite has to reach the vendor as a rebuild. Divergent history, a changed system prompt, catalog, model or effort, and any call carrying a `purpose` (compaction, session titles) all get a fresh child instead. A delta omits the conversation's own replies, which the vendor already has. Reported usage is the difference from the previous turn, because `agy` counts a conversation rather than a turn.

`maxTokens` is accepted and ignored on a `purpose`-carrying auxiliary call, and still refused on an ordinary turn: `agy` has no output-cap flag, but refusing it everywhere left compaction — which always sends it — unable to run at all.

DSH mints its own tool-call ids rather than trusting the model's, which are freely authored and routinely repeated; the vendor's id is restored on the wire so the model still recognises its own call. `docs/ARCHITECTURE.md` carries the measurements and the full rebuild rules.

### Typed tool arguments

The forced structured-output schema is built per tool catalog: each call variant pins `name` to one tool and `arguments` to that tool's own declared schema. It previously declared `arguments: {"type": "object"}` for every call, which an empty object satisfies, so a call missing every required field was well-formed as far as the vendor was concerned.

An auxiliary call (`purpose` set: compaction, session titles) gets a schema with no `tool_calls` property at all, because compaction replays the conversation's tool catalog for cache alignment and the model answered it by calling a tool instead of summarizing.

DSH tool schemas are rewritten into the vendor's accepted subset first. Annotation-only keywords are dropped and `const` becomes a one-member `enum`; a schema using a composite keyword (`$ref`, `oneOf`, `allOf`, `if`) falls back to the untyped object for **that tool alone**, never for the catalog around it.

### Per-turn stamp

Every envelope carries a `turn` field the reply must echo, and a decision stamped for any other turn is discarded. It exists because `structured_output` is not cleared between turns: measured on real `agy 1.1.24`, a turn that produced none of its own resolved with the **previous** turn's object, verbatim and schema-valid, while its `response` held plain prose. Read without the stamp that is indistinguishable from a fresh decision, so a stale `tool_calls` runs the same tool a second time and the model, handed a duplicate result, has every reason to answer in prose again — a repeated-identical-call loop generated inside the transport. The vendor documents the schema as binding "the terminal `result` event" while `--help` says "only applicable to the final result", so per-turn enforcement is treated as best-effort and its absence detected rather than relied on.

A stamp that does not match falls through to the turn's own `response` before failing, since the vendor's parse can miss a payload that is plainly there. When neither source answers this turn the conversation is abandoned rather than continued: the vendor is holding a turn DSH rejected, and the next request reopens from DSH's history.

### Context capacity

The route advertises `contextWindowTokens` (default `200_000`). It is configured, not discovered: the vendor discloses no per-model window. Without any capacity `compaction-basic` refuses automatic pressure compaction and the refusal is swallowed as a single warning, so a session's history would grow with no bound and no visible symptom.

### One tool transport, and why the other was removed

DSH's tool catalog reaches the model as text in the forced-output envelope, and the model answers with a decision DSH executes. There is nothing to install: this route works from a plain `agy` login.

A second transport existed until it was removed with the `transport` config key. It handed the catalog to the vendor's own harness as MCP tools so the model called them natively, through a server process the vendor launched and a unix socket back to the adapter. It was built, live-accepted and briefly the default. Three things ended it, and each is recorded with its evidence in `docs/ROADMAP.md` section 3:

- **it rested on four undocumented vendor behaviours**, where everything this transport needs is published bar one ambiguity that is now detected rather than trusted. The load-bearing one — that a blocking MCP call holds the vendor turn open — had already broken in production: a long tool becomes a yielded cell, the model is re-invoked at each yield boundary, and on one of them it stops waiting;
- **its setup could not be shipped, only asked for.** A globally registered server and a permission grant, both in your own vendor configuration, with a fresh install doing nothing until both were in place. Probed on `agy 1.1.24`: a workspace-scoped `.agents/mcp_config.json` is loaded and connected but its tools are never declared to the model, and a workspace `permissions` block is ignored outright, so neither half could move into the workspace this package creates;
- **it did not hold the property it existed for.** Two independent reviewers found the same hole: the one-shot token binds whichever process claims it first, so a co-resident process claiming first was served DSH's entire tool catalog while the real server was refused — and because the same sticky flag answers "did a server attach", the turn then came back as prose and was accepted as an ordinary success. An earlier version of this file claimed that race fails loudly. It did not.

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