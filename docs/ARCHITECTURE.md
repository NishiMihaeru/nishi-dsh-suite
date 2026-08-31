# Architecture

Status: canonical `0.1.0-rc.3` architecture. This document describes the current tree, which is **no longer the frozen accepted checkpoint**: a follow-up audit of Core, Project Memory and Codex found and fixed defects in all three, so Foundation and Codex are thawed and pending re-validation. See *Current implementation state* at the end for exactly what changed and what evidence does and does not exist.

The only supported DSH generation is official `0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`). `0.1.1-rc.2` and earlier are **not supported** and carry no compatibility claim. The manifests, the dev graph and every test now say exactly that; `docs/README.md` owns the policy statement.

## Product contract

Switching primary providers should be a route change, not an environment change. DSH keeps the same tools, Project Memory, Usage & Limits surface, profile and session context while provider packages translate vendor-specific protocols.

The runtime family has four architectural roles:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- one plugin per provider — vendor protocol translation and only the capabilities that provider actually exposes;
- `nishi-dsh-project-memory` — provider-agnostic project memory tools/context;
- `nishi-dsh-suite` — declarative composition and managed Orchestrator preset bridge.

A new provider must not require provider-specific Core, Project Memory or browser identity branches.

## Package family and DSH boundary

`0.1.0-rc.3` contains:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

Supported DSH generation: `0.1.2-alpha.1` only. rc.2 and earlier are unsupported.

Every declared DSH range in the repository is exactly `0.1.2-alpha.1` — Core and Project Memory peers, provider peers, and the Suite's own `dsh-authorization` dependency:

```text
0.1.2-alpha.1
```

The rc.2 union was dropped from every declared contract (`build!: drop DSH 0.1.1-rc.2 from every declared contract`). Ranges that narrow are not installable from npm until upstream publishes alpha.1, which gates publication rather than development. The local devDependency and test graph has also moved: Core and Project Memory build and test against `0.1.2-alpha.1` resolved from the local upstream checkout, so the alpha.1 side of the claim rests on the full workspace suite rather than on a one-off probe. Provider packages moved to `0.1.2-alpha.1` peers too, each on its own executable evidence, and do not inherit alpha.1 compatibility automatically from Core/Project Memory.

## Core

### Surfaces

| Entry | Plane | Role |
|---|---|---|
| `nishi-dsh-core` | host | publish registry and compose host services |
| `nishi-dsh-core/web-search` | agent | routed `web_search` |
| `nishi-dsh-core/client` | browser | Usage & Limits |
| `nishi-dsh-core/runtime` | library | shared vendor runtime + registration |
| `nishi-dsh-core/usage` | library | normalized usage service/contracts |

The browser never imports provider packages. Provider presentation crosses RPC as serialized data.

### Lifecycle and Connection

The outer Core publishes `NishiProvidersService`; the internal host child injects:

```ts
['nishiProviders', 'connection', 'credentials']
```

Core does not import or inject `@deepseek-ai/dsh-authorization`.

The Connection compatibility boundary supports exactly one shape now:

- alpha.1: authenticated two-argument `rpc.handle(channel, handler)`.

The `Function.length` arity probe that used to select between the rc.2 three-argument form and the alpha.1 two-argument form was removed with the rc.2 branch it selected (`build!: drop DSH 0.1.1-rc.2 from every declared contract`). `packages/core/src/host/connection-compat.ts` is now a plain passthrough: `registerConnectionRpcChannel()` remains as a named seam, not because a second shape still exists, but because it is the single place recording that Connection owns the returned disposer and Core must not add a second lifecycle owner.

### Credentials

Core has no Model Accounts surface. It was removed together with the provider-declared `account` capability that fed it — rows, browser section, host RPC handlers and the descriptor field alike — so no Core code path reads or mutates a vendor credential record.

The removal is total rather than disabled, for the same reason the authorization mutation surface was removed rather than kept inert: a surface that still exists is a surface that can be re-enabled by accident. Sign-in belongs to each vendor's own CLI or app, which was already true for Antigravity and is now true everywhere.

### Provider registration

Providers inject `nishiProviders` plus only required DSH services and call shared `registerProvider(ctx, descriptor, config)`.

Registration validates canonical identity/routes/presentation, constructs optional capabilities on the provider context, records the provider, registers model routes, runs provider install hooks, and rolls back Core-owned state if a later transaction stage fails.

Capability descriptors are shape-checked before their factories run, so a malformed `webSearch`/`usage` declaration fails as a named registration error rather than a bare `TypeError`. The rollback boundary is exactly the Core-owned registry entry and LLM adapter. Capability *instances* are built on the provider's own context and are not rolled back here — they carry no dispose contract, so a provider owning a resource must bind it to its own `ctx.effect`.

Registry observers are non-vetoing. Provider registration/withdrawal drives the live roster.

### Usage

Providers own usage collection/normalization. Core owns cache, invalidation, public projection and browser lifecycle.

`UsageCapabilityHooks.invalidate()` is an authoritative observation-generation boundary:

1. remove the provider's currently cached snapshot immediately;
2. advance an invalidation generation token;
3. cached host read APIs omit the invalidated provider;
4. refresh work that started before invalidation may resolve to its original caller but cannot republish into cache;
5. a post-invalidation refresh is not required to join superseded in-flight work;
6. successful refresh in the current generation publishes and clears that generation's invalidation token.

Browser `get-providers` is authoritative. If a provider is omitted, a prior browser-side `FRESH` snapshot is cleared so the next `ensureFresh()` can refresh it. There is no separate invalidation push channel; the guarantee begins at the next authoritative host/cache read.

Provider roster generations continue to fence stale browser async work so withdrawn/re-registered provider instances cannot be resurrected by old requests.

### Routed web search

Core reads the current session request header and dispatches only the backend registered for that exact route.

- malformed/unavailable route -> `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- valid route without search capability -> `WEB_SEARCH_UNSUPPORTED`;
- no fallback to another vendor.

A backend error keeps its own message when Core re-shapes it into the tool taxonomy, so whatever a provider puts in that message reaches the model. That is why the `VendorFailure` contract in `nishi-dsh-core/runtime` is the required construction path for a provider diagnostic built from a failed vendor process: raw vendor stderr is never forwarded, only a recognized and provider-authored sentence, or an unattributed category with exit/signal metadata. Codex is the reference consumer of that contract.

## Codex vendor threads

An ordinary DSH turn **resumes** the vendor thread rather than forking a new one. The adapter calls `thread/start` only for the first turn. After that, `thread/resume { threadId, ...overrides }` gets the thread's current tip from the response's own `thread.turns` — no extra round trip. If the DSH checkpoint is that tip, nothing else is needed, which is the common case and the one that keeps the prompt cache. If the checkpoint is an ancestor of the tip (DSH history was rolled back or edited), `thread/rollback { threadId, numTurns }` drops exactly the turns after it before the turn proceeds. `thread/fork { threadId, lastTurnId }` is kept only for what resume and rollback cannot express: a checkpoint turn that is neither the tip nor an ancestor of it — fork addresses a turn by id regardless of the thread's current tip, which is the property it was originally chosen for. All three set `ephemeral: false`. Only the delta since the checkpoint crosses the wire either way — `prepareCodexHistory` slices the messages after the checkpoint, so prior turns are never re-transmitted. The shared start/fork/resume configuration overrides are factored into one helper so they cannot drift apart: a resumed turn still re-applies DSH's current system prompt and isolation config rather than pinning them to the first turn's values.

This is a real implementation, not a proposal: `perf(codex)!: resume the vendor thread instead of forking every turn` landed it, with a stale-checkpoint/deleted-vendor-thread recovery path unchanged (`recoverableCheckpointError` still falls back to rebuilding from DSH history when the vendor thread or turn is gone).

### Measured vendor behaviour

These numbers were measured against real `codex-cli 0.150.0`, not inferred, before the redesign landed. They are recorded here because they were expensive to obtain, are not discoverable from the code, and are why resume was chosen.

| Thread handling | Cache credit per turn |
|---|---|
| `thread/fork` every turn (previous design) | **0**, on every turn of a 5-turn run |
| `thread/resume` on one thread | ~3840 of ~4200 input tokens, from the second or third turn onward |
| `thread/resume` after `thread/rollback` of the newest turn | **unchanged** — 3840 before and after |

Forking re-billed the entire accumulated context as fresh input on every turn; resuming does not. The prefix — system prompt plus tool catalog, roughly 1950-4050 tokens depending on the run — is identical across turns and is exactly what went uncached under fork.

Also established from the live protocol:

- `thread/resume`'s own response carries `thread.turns`, so the vendor thread's tip is known without a separate `thread/read`;
- `thread/rollback { threadId, numTurns }` genuinely truncates turns and clamps gracefully when asked to drop more than exist;
- `thread/delete` and `thread/archive` exist, so vendor-side threads this suite created can be cleaned up.

Fork and resume runs used `gpt-5.6-sol`; the rollback run used `gpt-5.6-luna`. Absolute magnitudes are therefore not comparable across runs — the load-bearing comparisons are within-run: fork's zero against resume's non-zero at the same turn positions, and turn 4's credit against turn 3's across the rollback.

### Consequences of the current design

Resuming leaves **one vendor thread per session** persisted in the user's own vendor account, carrying that session's runtime context and project contract, instead of one per DSH message. That is still durable storage outside DSH's control that DSH cannot clean up today — anyone reading `docs/` before changing thread handling further should know this is a privacy property, not only clutter.

This does not retroactively change anything: vendor threads created before this change (one per message, under the old fork-per-turn design) still exist in the user's vendor account exactly as they were. Only sessions that continue or start after the redesign accumulate at the new, lower rate.

`thread/inject_items` remains **unverified**: the call succeeds, but injected items are invisible through both `thread/read` and `thread/resume`, so nothing has confirmed they reach the model, even though the adapter depends on it for history that follows a checkpoint. This is the one open item carried from the design decision; see `docs/ROADMAP.md` §7a.

Rollback is destructive where fork was not — it discards the truncated turns rather than leaving a branch behind. That is accepted because DSH's own history no longer reaches those turns either.

Whether this suite should clean up the vendor threads it creates (`thread/delete` / `thread/archive` exist) was raised as an open decision and has since been closed: the maintainer decided old sessions do not matter, so no cleanup behavior is implemented and none is planned against previously created threads.

## Codex history projection

DSH's durable history is provider-neutral. A `user` or `system` message may carry any block a producer emitted, including blocks the vendor's own input format has no slot for. Codex App Server input carries text and images only.

Where the two disagree the block is **projected to text**, never rejected: `[dsh: tool call read({"path":"/etc/hosts"})]`, `[dsh: reasoning]`, `[dsh: failed tool result for c1]`, and for a block type this suite does not know, its type. One function (`packages/codex/src/codex-plugin-dsh/content-projection.ts`) serves every site that needs it — history replay, the current turn's input, a dynamic tool's result, context steered into a still-running turn, and the primary bridge's pass over the transient request — so the bridge's projection and the plugin's own are idempotent with each other. Durable DSH history is not rewritten; only the request handed to Codex is.

Rejecting instead is what this replaced, and the failure was not confined to one turn. A subagent stopped mid-tool-call has its terminal output copied into a `user` notice verbatim, `tool-call` blocks included; the plugin threw, the turn died before a checkpoint could be written, and every later prompt in that session then rebuilt from DSH history, hit the same block and threw again. One interrupted subagent broke Codex for that thread permanently (issue #4).

Two consequences worth knowing before changing this:

- whether a trailing non-tool `user` message is the current turn's input is decided by position alone. Deciding it by content — as it once was — sends a notice whose last block is a `tool-call` to history instead, and a turn woken by nothing but that notice then has no input at all;
- one case is lossy on purpose: an image nested inside a projected `tool-result` becomes a marker, because no input item is being emitted to attach its bytes to. Top-level images in a `user` message are unaffected.

Assistant content is deliberately not covered by this. `assistantHistoryItems` still rejects an `image` or `tool-result` block in an assistant message: that is the vendor's own output shape rather than producer-supplied context, and a text stand-in there would fabricate a turn the model did not produce.

## Subagent model routes

A spawned subagent is an ordinary DSH agent with its own session, and it reaches its model through `ctx.llm` like any other agent. So every registered primary route is usable as a subagent model, `codex-app-server` and `antigravity-cli` included, and no provider package contributes anything delegation-specific to make that true. This is the same reasoning that removed the vendor delegation tools in rc.3: a child on the session's own machinery beats a second vendor environment with its own tools, permissions and memory.

What the Suite owns here is one line of composition. The Orchestrator preset mounts `subagent` with `modelSelectionSettings: true`; without it a child is pinned to the parent's route and no route selection surface exists at all. `subagent_fork` keeps it off, because a forked child inherits the parent's completed-turn prefix and that prefix stays eligible for KV Cache reuse only while the route is unchanged.

Everything else belongs to DSH and to the user:

- the host service `@deepseek-ai/dsh-tool-subagent/model-selection-settings` is a singleton mounted by the official web-app bundle. The Suite bundle patch must not mount a second copy; the `subagent` row fails loud at mount time in a profile that has neither;
- the allowlist is a user authorization, off with an empty list by default. It names exact provider/model pairs, is sampled when a session's agent is published, is recorded durably on that session, and refuses any route outside itself at delegation time. The settings catalog is built from `ctx.llm.listProviders()`/`listModels()`, so a Suite provider appears in it as soon as it registers its adapter.

That allowlist is deliberately static and user-maintained: it authorizes spending someone's subscription quota, so a vendor adding a model does not silently become a route a model may select. Publishing the live catalog as the allowlist — a drop-in `subagentModelSelection` service reading `llm/adapters-updated` — is a possible convenience, not the default, and is recorded in `ROADMAP.md` rather than implemented.

Two properties of a cross-route child follow from the design rather than from a delegation decision. A child routes its own `web_search` through its own route, because search follows the session's current primary route with no fallback. And Codex opens one App Server process per active turn keyed by session, so a parent plus N concurrent children on `codex-app-server` are N+1 vendor processes drawing on one subscription concurrently.

Both directions and the concurrent case were exercised live on 2026-08-31 in the real `web` profile, and each child's route is evidenced by its own session `request/header` rather than by the parent model's report: Codex parent with an Antigravity child, Antigravity parent with a Codex child, and one parent turn with two concurrent background Codex children (six concurrent vendor processes at peak, no residue). `docs/verification/README.md` records the run.

What that run exposed is not in delegation but in Codex, and is fixed: a turn whose first step runs on another provider and emits tool calls, and whose next step resolves on `codex-app-server`, used to fail with `codex-plugin-dsh: the current Codex turn has no user input`. See *Codex tool-result continuation* below.

## Codex tool-result continuation

The active-turn path answers a Codex dynamic tool call with its own result, so an ordinary tool loop never reaches history preparation at all. A request arrives holding nothing but tool results only when no Codex turn is open to answer them: the step that made the calls ran on another primary route, or the vendor turn was lost. That state used to fail the turn, because current-turn input is decided by position and a tool result is never that input.

It now continues instead. The trailing run of tool-result messages becomes the turn input, projected to text like any other block the Responses input format has no slot for, behind one harness-authored line that says why the input looks like that. The same results also stay in the imported history, where they pair with the `function_call` items of the step that made them.

Sending them on both paths is deliberate, and it is a hedge rather than a preference: unpaired `function_call` items are a vendor-side error risk, while `thread/inject_items` is still unverified (*What remains* in `HANDOFF.md`). One repetition buys a turn that works under either. If injection is ever confirmed to reach the model, the projection can go.

The position rule itself is unchanged — content still never decides what the current input is. What changed is that an otherwise inputless turn has a defined continuation instead of an exception.

## Antigravity session-lived vendor conversation

Every DSH step used to be a whole `agy` process: spawn, write the entire DSH history as one JSON user message, read one result, kill. There was no branching by session kind, so this was equally true of the primary agent, of every subagent step, and of every routed web search.

That guaranteed a fresh vendor conversation per step, which has three costs. A fresh conversation cannot hit the vendor's prefix cache, so every step re-read the whole history at full price. Every step paid a cold `agy` start — auth, plugins, agent load, workspace scan — in the critical path. And the model never saw its own prior replies as its own turns; they came back as JSON quoted at it inside a user message, which is the weakest available signal that it has already done something. A model that cannot tell an answered call from an unanswered one calls again, and nothing bounded that: the DSH agent loop has no step cap, and `subagent` has no round cap.

The vendor already supported the alternative. `agy --input-format stream-json` "reads one NDJSON message per line from stdin and runs a turn for each", and `--json-schema` is enforced on each of those turns, not only the last. Measured against real `agy 1.1.22`: two turns in one child reported cumulative `input_tokens` of 23496 then 26784, with `cache_read_tokens` of 0 then **20418** — the continuation paid for ~3.3k new tokens instead of ~23.5k. Below roughly 20k of prefix the vendor's cache does not engage at all, so the saving appears exactly where it matters and not on toy exchanges.

The adapter now holds one live child per DSH session, keyed by `GenerateOptions.sessionId`. The first request sends a `full` envelope — system prompt, history, tool catalog — and each later step sends a `delta` envelope carrying only the messages DSH appended since the last reply. This is the same shape Codex has had since its thread redesign; what differs is that Codex holds a connection to a server and resumes a vendor thread, while Antigravity holds the CLI process itself.

Three rules make reuse safe rather than merely cheap.

**A live conversation is continued only by a request that extends exactly what it was told.** DSH history is authoritative and gets rewritten behind the adapter's back — compaction shadows nodes, the tool-result pruner truncates, repair injects synthetic results, the user rewinds — and none of that is expressible to a vendor that has already heard the original. The adapter compares the request's message ids against the ids it has delivered; a mismatch closes the child and reopens from DSH's copy. The same applies to anything sent once as prefix: a changed system prompt, tool catalog, model or effort rebuilds, because a delta cannot revise them.

**An auxiliary call never touches the session's conversation.** A compaction fold or a session-title request carries the session id but brings its own system prompt and its own one-off history, so `purpose` sends it to a throwaway child. Sharing would fail the prefix test and tear the real conversation down on every fold — precisely the cost the live child exists to avoid.

**Reported usage is a difference, not the vendor's running total.** `agy` counts a conversation, not a turn: across four measured turns in one child, `input_tokens` ran 4205, 8606, 13203, 18001 for one-word exchanges. While every step was its own process that total happened to be the step's own and DSH could add the reports up. It no longer is, so the adapter subtracts the previous report. Left unsubtracted, the token meter would re-count the same tokens once per remaining step, inflating a session quadratically and tripping compaction early — the same meter that decides when to compact.

Two supporting changes come with it. Tool-call ids are now minted by DSH rather than taken from the model, because the vendor's ids are model-authored and routinely repeated — `call_1` on every step is normal — which leaves a history full of results the model cannot match to their calls. The vendor's own id is kept in a per-session map and restored on the wire, so the model still recognises its own call. And the route now advertises a context capacity (see below), without which none of the compaction this section relies on runs at all.

Coverage: `test/session-reuse.test.ts` (reuse, delta contents, id translation and uniqueness, every rebuild trigger, auxiliary isolation, session separation, usage subtraction, dispose) and `test:live:session-continuation`, which asserts against real `agy` both that one child served both steps and that the model's answer contains a value it could only have read from the tool result.

## Antigravity structured-output schema

The bridge forces the model's reply through `--json-schema`. That schema used to declare `arguments: {"type": "object"}` for every tool call, which constrains the model to nothing: an empty object satisfies it. A call could therefore be emitted with none of the tool's required fields, be well-formed as far as the vendor was concerned, fail in DSH, and be retried by a model with no way to see why — one of the two mechanisms that turned a small task into an unbounded tool loop, the other being the repeated call ids above.

The schema is now built per tool catalog: each call variant pins `name` to one tool and `arguments` to that tool's own declared parameter schema, so a malformed call is unexpressible rather than merely discouraged. `anyOf` with an `enum`-of-one discriminator is used rather than `oneOf` with `const` because that is what the vendor's subset accepted when probed against real `agy 1.1.22`; a single-tool catalog skips the wrapper entirely.

DSH tool schemas are authored for a full JSON Schema validator, not for the vendor's subset, so each is rewritten before it goes in. Annotation-only keywords (`format`, `title`, `pattern`, `$schema`) are dropped, `const` becomes a one-member `enum`, and an object-valued `additionalProperties` or any composite keyword (`$ref`, `oneOf`, `allOf`, `if`) abandons **that one tool** back to the untyped `{"type":"object"}`. The bail-out is per tool rather than per catalog on purpose: a composite keyword cannot be dropped without changing what the schema means, so quietly weakening one tool's contract is not acceptable — but neither is letting one exotic tool disable argument typing for every other tool beside it. Dropping the annotations is safe in a way that dropping a composite would not be: DSH validates received arguments with its own validator regardless, so an under-constrained model gets a tool-result error it can read.

A request with no tools keeps the generic schema, so nothing pushes it toward emitting a tool call it has no catalog for.

An auxiliary call gets a third schema, which permits `kind: "message"` and has no `tool_calls` property at all. Compaction replays the conversation's own system prompt AND its tool catalog deliberately, so its request stays a genuine prefix of the last routed one and remains cache-aligned; once the bridge began typing tool arguments, that made the summarizer look exactly like an ordinary turn holding the full catalog and an unfinished task, and the model answered it by calling a tool. `kind` came back `tool_calls`, `text` was empty, and compaction died with `summarization produced no text summary content` -- 7 of 8 attempts in one measured session, with the single success arriving at step 158 of 175. Removing the property rather than bounding it makes the wrong answer unexpressible using only keywords the vendor was probed to accept, and the envelope still carries the tools, so the prefix alignment compaction wants is untouched. An auxiliary reply with no `tool_calls` key is read as an empty list.

## Antigravity context capacity

`compaction-basic` resolves the routed model's `context.contextWindow` before automatic pressure compaction and throws `TargetPressureConfigError` when there is none. The `agent/pre-step` hook catches that, logs one warning per target, and continues the turn. So a route that discloses no capacity does not fail — it silently never compacts, and its history grows without bound.

Antigravity disclosed none, and unlike Codex it has no overflow backstop either: Codex reports `contextWindowExceeded` and ends the turn as `max-tokens`, which is a recoverable signal, while `agy` gives the adapter nothing equivalent. So an Antigravity session had no bound of any kind on its history.

Advertising a capacity was necessary but not sufficient, and the gap between the two is worth recording. Compaction then began running and failing on every attempt, because it sends `maxTokens` and the adapter rejected any request carrying it -- 35 consecutive `compaction/end` failures in one measured session, each swallowed by `agent/pre-step` as a single warning while the context grew past 150k. `agy` has no output-cap flag, so the rejection was honest for an ordinary turn and useless for an auxiliary one: compaction and session titles pass `maxTokens` as a budget hint for a summary nobody measures. It is now accepted, and ignored, exactly when `purpose` is set; an ordinary turn that asks for a hard ceiling still fails loudly, because there is no way to honour it.

The route now advertises `contextWindowTokens`, defaulting to 200 000. This is deployment-owned rather than discovered: `agy models` emits an id and a display name and nothing else, and no vendor surface reports a per-model window. The default is deliberately below every current Gemini window, because the two errors are not symmetric — compacting earlier than strictly necessary costs one extra fold, while not compacting costs the session.

Codex is deliberately left alone here. It has the overflow backstop above, and inventing a window per `gpt-5.x` id would be a guess with no evidence behind it; that figure needs a maintainer decision, not an adapter default. Recorded in `ROADMAP.md`.

## Antigravity model catalog and reasoning efforts

The vendor's catalog has no reasoning-effort dimension: it ships `gemini-3.7-flash-low`, `-medium` and `-high` as three separate model ids. Presented that way, one model family fills three rows of every model picker and DSH's own reasoning-effort surface stays empty.

The adapter collapses them. A family whose suffixed ids cover at least two distinct efforts becomes one model — `gemini-3.7-flash` — advertising `low`/`medium`/`high`, and the suffixed ids it absorbed are kept as aliases. A model with only one variant (`gpt-oss-120b-medium`) is left exactly as the vendor named it and advertises no efforts, because a lone suffix is not evidence of a family.

Invocation maps back: both a base id and any alias invoke `--model <base> --effort <level>`, with an effort from the request winning over the one the alias carries. That mapping resolves through model discovery rather than through a peek at its cache — a cache that expired between route resolution and the turn would otherwise send a suffixed id together with an `--effort` flag that disagrees with it. Discovery failure is not allowed to lose a turn whose id is already valid, so it falls back to invoking exactly what was requested.

Two consequences are worth stating rather than discovering.

A base id resolved without an explicit effort reports `high` as its default, and DSH materializes adapter defaults into the request header, so a plain `gemini-3.7-flash` turn runs at High. That is a deliberate choice of the strongest tier over the cheapest, taken by the maintainer on 2026-08-31; a route that names its own effort overrides it.

The catalog no longer advertises the suffixed ids, so a subagent allowlist entry naming one — including entries recorded in sessions from before the collapse — will not appear in `list_subagent_models`, even though the adapter still accepts it if a child names it exactly. Allowlists written against the current catalog use base ids.

## Project Memory

### Root and context

Project Memory uses one root policy for context and tools:

- session `cwd` must be absolute;
- walk upward to nearest `.git` marker, including worktree-style `.git` files;
- if no Git marker exists, use normalized explicit `cwd`;
- context injection and memory tools use the same discovered root.

Explicit workspace roots may be symlink paths. Package-owned `.dsh`, `.dsh/memory`, and `.dsh/local` final components must be real directories.

`DSH.md` and bounded `MEMORY.md` are injected lazily on `agent/pre-step`; topic files are read on demand. Concurrent initialization does not share one cancellable promise between agents.

### Storage confinement

On POSIX, package-owned descendants are opened through one descriptor chain:

```text
projectRoot -> .dsh -> memory/local
```

Opened directories are bound to device/inode identity and descriptor paths where available. Final-file reads use `O_NOFOLLOW` where available and verify the opened file against the visible entry before consuming bytes. Atomic writes and first-publication operations are anchored to the same opened parent generation.

If a regular file is opened successfully and the canonical pathname is then concurrently unlinked before visible-identity recheck, `readRegularFile()` returns current namespace absence (`null`) instead of exposing bytes from the now-unlinked inode. If the pathname instead resolves to a different inode, symlink or non-file entry, the operation still fails closed.

Windows has no equivalent Node directory-fd/openat implementation here. It remains **NOT TESTED** and does not inherit the stronger POSIX TOCTOU claim.

The storage layer does not `fsync` file/parent-directory contents; sudden power-loss durability remains out of scope.

### Bootstrap bounds

`MEMORY.md` has a 25 KiB / 200-line model-facing bound.

The bound is also an ingestion boundary:

- read-only bootstrap projection reads only a bounded prefix sufficient for UTF-8-safe truncation;
- existence-only paths read zero content bytes;
- read-modify-write bootstrap/map operations reject an oversized persisted file from metadata before whole-file materialization.

Named topic files remain capped at 256 KiB.

The same discipline covers the two user-facing files initialization rewrites: `.dsh/project.json` is read under a 64 KiB bound and `.gitignore` under 1 MiB. Neither is package-owned, so neither may be materialized without a bound just because it is small in practice.

### Writer locks

All Project Memory RMW targets use the same `<target>.lock` namespace as DSH atomic-write coordination.

Current Project Memory locks are generation-safe populated directories. One owner marker contains:

- lock format version;
- PID;
- random acquisition token;
- OS process-birth identity when available.

The populated temp directory is atomically published with `rename()` only after the owner marker exists. Structural destination-collision errno values from that publication step (`EEXIST`, `ENOTEMPTY`, `ENOTDIR`, `EISDIR`) are authoritative contention signals and are not reclassified through a racy post-failure pathname `lstat()`. Ambiguous permission-style codes retain conservative handling.

Lock release is conditional on the exact observed owner generation and opened directory identity. It removes the expected marker, then `rmdir()` succeeds only if the canonical pathname still refers to the same empty directory. A replacement live owner publishes a populated directory and cannot be deleted by the delayed old finalizer.

Legacy numeric-PID regular lock files remain readable for recovery/interoperability with older state; current Project Memory writers no longer create them.

A queued waiter gets a 10 s budget before it reports a lock timeout. The number is sized for what the holder actually does under one lock — a WAL publish plus two atomic participant writes — rather than for the uncontended case. The budget is overridable per scope through `lockWaitMs`; there is no public package configuration for it yet.

The namespace is bidirectionally compatible with `@deepseek-ai/dsh-atomic-write`: an upstream regular lock blocks Project Memory, and upstream exclusive creation treats the Project Memory directory lock as contention. This was exercised in the accepted Foundation validation.

### Process ownership and PID reuse

PID liveness alone is insufficient because numeric PIDs are recycled.

New persisted journal/lock ownership carries process-birth identity where supported:

- Linux: `/proc/<pid>/stat` process start time;
- macOS: `ps` process start time.

A live numeric PID with a mismatched birth identity is not the original owner and does not keep dead recovery state alive indefinitely. When a reliable birth identity cannot be obtained, recovery fails closed and treats a live PID as live rather than guessing stale ownership.

### Cancellation and settlement

Caller `AbortSignal` propagates through root discovery, recovery, lock waits, reads and ordinary commit boundaries.

If failure/cancellation happens after a compound operation already durably replaced one participant, exact rollback becomes mandatory settlement. Settlement reuses the opened storage generation without consulting the already-fired caller signal until pre-images/WAL state are restored. This exception is limited to restoring already-durable partial state.

### Named-topic transaction

Model-facing named-topic writes/edits use fixed lock order:

```text
MEMORY.md -> <topic>.md
```

`.dsh/local/project-memory-transaction.json` records:

- journal version;
- `pending` / `committed` phase;
- owner PID;
- optional process-birth identity;
- random transaction-generation id for current writers;
- topic id;
- exact pre-images of topic and `MEMORY.md`.

Old journals without identity/generation fields remain readable for one-way recovery compatibility.

For current journals, `transactionId` is the generation identity. For legacy journals without `transactionId`, generation comparison uses immutable transaction payload (`topic`, `topicBefore`, `memoryBefore`); mutable owner PID/identity is checked separately. This permits explicit fail-closed owner-transfer handling instead of conflating ownership transfer with transaction replacement.

Protocol:

1. open one pinned `projectRoot -> .dsh -> {memory, local}` generation;
2. hold `MEMORY.md` then topic lock;
3. preflight/capture bounded participant state;
4. atomically publish `pending` WAL mode `0600`;
5. commit topic;
6. commit Memory map;
7. atomically replace WAL with `committed`, still mode `0600`;
8. while participant locks remain held, best-effort remove only that exact committed transaction generation;
9. release participant locks/scopes.

Step 7 is the logical commit point. Cleanup failure after it is preserve-and-clean metadata, never a reason to roll committed participants back.

Transaction generation identity plus cleanup under participant locks prevents delayed cleanup from transaction A from deleting pending transaction B at the fixed journal pathname.

Recovery semantics:

- dead `pending` -> claim and restore exact pre-images;
- dead `committed` -> preserve new participants and clean metadata;
- live matching owner -> cross the `MEMORY.md` barrier before deciding whether anything remains to settle;
- recycled PID with mismatched birth identity -> stale owner;
- a journal may only be claimed after its owner is proven dead by a read taken under the journal lock;
- every pre-claim mismatch between that locked read and the caller's earlier unlocked read — journal gone, generation or phase replaced, owner transferred in either direction, owner alive again — is a stale observation, not lost proof, because no participant has been touched yet. Recovery re-observes from scratch, bounded, and the fresh read decides again whether to await a live owner or claim a dead one;
- ownership/WAL mutation that destroys proof *after* this recovery wrote its own claim -> fail closed.

Concurrent recovery of one abandoned journal is therefore an ordinary outcome: one caller settles it and reports `true`, the others report `false`. Recovery never fails a caller's unrelated read or write just because that caller lost the race. If observations keep churning past the bound, recovery reports `false` rather than looping; that is safe because a genuinely unresolved journal still blocks the next `createPendingProjectMemoryTransaction` through its exclusive create.

### Recovery ownership layer

Recovery is owned by Project Memory domain operations. Tool wrappers do not run a redundant pre-dispatch recovery and then invoke a domain operation that immediately recovers again. This reduces I/O and recovery interleavings without changing the tool contract.

## Architectural overcomplexity disposition

The audit distinguished correctness complexity from removable complexity.

Simplified and accepted:

- duplicate tool-layer Project Memory recovery;
- implicit PID/pathname ownership replaced by explicit lock/transaction generations;
- the Core authorization begin/submit/cancel/logout state machine, host and client alike. It was previously retained while disabled; a disabled mutation path that still carries a secret-typed prompt channel is a liability rather than compatibility, so it was removed instead of kept inert;
- the hardcoded Model Accounts vendor roster, first replaced by a provider-declared `account` capability and then removed outright with the whole Model Accounts surface;
- the rc2/alpha Connection `Function.length` compatibility shim, removed together with the rc.2 branch it selected once the peer range was narrowed to `0.1.2-alpha.1` (`build!: drop DSH 0.1.1-rc.2 from every declared contract`).

Intentionally retained until a separate compatibility review:

- usage invalidation generation tokens, because they fence real in-flight observation races;
- one fixed Project Memory journal pathname, because generation identity + lock order closes the audited race without requiring a larger WAL-directory migration.

The accepted follow-up review found no reason to replace these with a larger Foundation rewrite. Further cleanup must remove a concrete invariant/API burden rather than merely shorten code.

## Invariants

1. Providers register through shared `registerProvider()`.
2. Core has no provider-package dependency, and no vendor identity anywhere in its source: every provider-shaped surface — model routes, usage, presentation — is derived from registry declarations.
3. Provider ids/routes are canonical before mutation.
4. Model capability implies at least one route; capability absence is legal.
5. Browser provider identity comes from serialized presentation data.
6. Web search follows the exact current route with no vendor fallback.
7. Usage invalidation cannot leave host cached reads serving vendor-superseded state.
8. Stale browser async work cannot resurrect old provider generations.
9. Core has no credential-backend or Model Accounts surface; a provider capability must not read, mutate, or otherwise gain access to vendor credential state through Core. (Vacuous today in the sense that no such code path exists to violate; stated as a prohibition on reintroducing one, not as a description of live machinery.)
10. Legacy-grant deletion must not be reintroduced without a reviewed atomic-safe credential contract, and any such mutation surface must be absent when not justified by one — never merely disabled/inert. (Also a prohibition, not a description of an existing disabled path: the mutation surface was removed outright, not kept and switched off.)
11. A provider diagnostic built from a failed vendor process is constructed through `VendorFailure`; raw vendor stderr never reaches a diagnostic, a DTO, or the model.
12. Project Memory root selection/storage confinement is provider-independent.
13. POSIX package-owned descendants use one pinned `projectRoot -> .dsh -> memory/local` descriptor chain.
14. Project Memory RMW read/render/write stays on one opened directory scope.
15. Current lock ownership has a unique generation token; delayed release/recovery must not remove a replacement owner.
16. Lock publication collision classification must not depend on the lock pathname still existing after the failed publication syscall.
17. Persisted process identity prevents PID reuse from proving false ownership where the OS seam is available.
18. Named-topic mutations hold `MEMORY.md` then topic lock.
19. WAL generations distinguish transactions that reuse the fixed journal pathname.
20. Legacy WAL generation identity excludes mutable owner identity; ownership is validated separately.
21. `pending` is rollback state; `committed` is preserve-and-clean state.
22. Journal phase replacement preserves owner-only permissions.
23. Caller cancellation applies to ordinary work; mandatory settlement may ignore an already-fired signal only to restore already-durable state.
24. Concurrent canonical unlink after successful file open is absence, not permission to expose stale unlinked bytes. Replacement by a symlink or other non-regular entry still fails closed with the original error; replacement by a different regular file is surfaced as a distinguishable error type so a caller reading without a lock can choose to re-observe instead of failing outright.
25. A journal is claimed only after a lock-held read proves its owner dead; a stale pre-claim observation — including the fixed journal pathname being atomically replaced by a different regular file — is re-observed, never failed, and never lets an unrelated caller's operation fail. That re-observation is bounded and applies only to the unlocked pre-claim probe: replacement by a symlink or other non-regular entry still fails closed there, and any change to the journal after this process has durably claimed it still fails closed regardless of shape.
26. Losing a recovery race is a normal outcome; only mutation of a claim this process already wrote fails closed.
27. Every Project Memory read-modify-write path bounds the bytes it materializes, package-owned and user-owned files alike.
28. `0.1.2-alpha.1` is the only supported DSH generation; rc.2 and earlier carry no compatibility claim. Every declared range, the dev graph and the whole test suite say exactly that. The ranges are not installable from npm until upstream publishes alpha.1, which gates publication rather than development.
29. Web search output is external, attacker-reachable text: every rendered `web_search` result leads with the untrusted-content notice and the registered system-prompt guidance says the same, so returned content is never presented to the model as instructions.
30. Windows remains NOT TESTED.
31. A producer-supplied context block a vendor input format cannot carry is projected to text, never rejected: rejecting it fails the live turn and, with no checkpoint written, every later replay of that session. Durable DSH history is never rewritten to satisfy a vendor format. This governs `user`/`system` context only; vendor-shaped assistant content is not given text stand-ins.

## Current implementation state — THAWED, PENDING RE-VALIDATION

The previously accepted implementation and its PASS report were:

```text
implementation: 7cd4d5b17625f9b3a21b741555df6597fd9cb889
raw PASS report: d1cbac7094488ded52d9ab83891531bc01197090
```

That evidence no longer describes this tree. A follow-up audit of Core, Project Memory and Codex reproduced defects in all three, and the remediation changed behavior in each. **The old PASS must not be promoted to the current implementation.** Core, Project Memory and Codex are no longer frozen; they need their own validation run before any freeze claim is restored.

What changed since the accepted checkpoint:

- Project Memory recovery no longer fails a caller that loses a benign pre-claim race; the fail-closed boundary moved to post-claim mutation only. Invariants 25 and 26 are new and one previously documented invariant was deliberately weakened.
- Project Memory bounds the two user-owned files initialization rewrites, and the writer-lock wait budget moved from 2 s to 10 s and became overridable per scope.
- Core validates capability descriptors before their factories run, and the registration rollback boundary is now stated precisely rather than implied.
- Core's browser usage controller can no longer strand an in-flight refresh record, and it disposes.
- Model Accounts was first made registry-derived and then removed entirely, together with the `account` capability and the disabled authorization mutation surface — host and client alike. This is a public-surface removal in an unpublished `0.1.0-rc.3`.
- Codex routes every vendor-process diagnostic through `VendorFailure`, closing a path that put raw vendor stderr in front of the model. Its native search verifies the vendor runtime once per executable instead of once per query.

Local gate on the current tree: PASS. `pnpm verify:local` exits `0` on three consecutive runs; current focused test counts are Core `199`, Project Memory `77`, Claude `6`, Antigravity `99`, Codex `81`, Suite `16`. (The `209`/`61`/`7`/`7` figures from the first post-audit re-validation are themselves now history: the Model Accounts removal, the Codex thread-resume redesign and the Antigravity catalog/diagnostic/usage rework each changed a package's test count since.) Codex live acceptance passes on this tree, re-run in full on 2026-08-31 at Codex `78` tests, so the context-block projection fix (*Codex history projection* above) is now covered by a live run and not only by focused tests: primary, the full 15-scenario suite, and both web-search suites (`test:live:web-search`, `test:live:web-search-routed`) all PASS — the two web-search suites require `DSH_LIVE_CODEX_SEARCH_MODEL` to be set, and fail a precondition assertion (not a product defect) without it. Antigravity live acceptance passes on this tree, re-run **after** the session-lived vendor conversation and the per-tool output schema landed: primary 8/8 and `test:live:session-continuation` 1/1 against real `agy 1.1.22`, so both changes carry live evidence rather than focused tests alone. The continuation suite asserts what a surviving turn cannot: that one child served both steps, and that the model's answer contains a value obtainable only from the tool result. The 23 tests these changes added are the difference between the `73` the earlier acceptance suite ran at and the `96` above. Native and routed web search were last run on 2026-08-31 and have not been repeated, which is sound — neither change touches the search backend. Cross-route delegation was exercised end to end for the first time in the same session (*Subagent model routes* above). It found one Codex defect, now fixed and covered by focused tests plus `test:live:tool-result-continuation` (*Codex tool-result continuation* above); the three tests that fix added are the difference between the `78` the acceptance suite ran at and the `81` above. A green local gate plus these live suites is still not an acceptance: no independent validation by a party that did not write the code, and no alpha.1 runtime probe, has been repeated against this tree.

Windows remains NOT TESTED. `packages/antigravity` no longer carries a raw-vendor-stderr pattern: `packages/antigravity/src/vendor-stderr.ts` mirrors the Codex `VendorFailure` module, and every vendor-process diagnostic site in the package routes through it.
