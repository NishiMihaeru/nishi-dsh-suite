# Roadmap

Status updated for `0.1.0-rc.3` after accepted Foundation revalidation against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`), which is the only supported DSH generation; rc.2 and earlier are unsupported. `docs/README.md` owns that policy.

This file owns task status and order only. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## 1. Foundation — THAWED, PENDING RE-VALIDATION

A follow-up audit of Core, Project Memory and Codex reopened this freeze again. It reproduced a Project Memory recovery race that failed unrelated memory operations, a Codex path that put raw vendor stderr in front of the model, and a set of smaller correctness and architecture defects. All were remediated; see `docs/HANDOFF.md` for the itemized list.

Local re-validation of this tree first returned FAIL — `pnpm verify:local` gave FAIL, PASS, PASS over three runs, on a load-sensitive Project Memory recovery read race that failed an unrelated caller's memory operation. That defect is fixed and the gate is now green: `pnpm verify:local` passes on three consecutive runs; current focused test counts are Core `202`, Project Memory `79`, Codex `90`, Claude `6`, Antigravity `128`, Suite `17` (the `209`/`61` figures recorded right after that fix are themselves superseded by the Model Accounts removal and the Codex thread-resume redesign since). A single `build`/`check`/`test` pass exited `0` throughout, which is why the Project Memory race was missed — treat that as the weaker signal it is. See `docs/HANDOFF.md`. Codex and Antigravity live acceptance now both pass on this tree (see §2 and §3), but there is still **no** independent validation by a party that did not write the code, and no alpha.1 runtime probe has been repeated against this tree. The freeze claim below is history.

Previously accepted implementation, now superseded:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Foundation gates:

- [x] Project Memory journal-generation cleanup race fixed;
- [x] Project Memory stale-lock replacement/finalizer race fixed;
- [x] Project Memory PID-reuse ownership hardening implemented for Linux/macOS;
- [x] Core unsafe legacy credential read-kind-then-delete mutation removed/fail-closed;
- [x] Project Memory bootstrap ingestion bounded before whole-file materialization;
- [x] Core usage invalidation made authoritative for host cache and browser reconciliation;
- [x] Project Memory journal phase replacement preserves `0600` on POSIX;
- [x] writer-lock publication collision handoff race fixed;
- [x] concurrent journal open/unlink recovery preflight handled as current absence;
- [x] legacy transaction generation separated from mutable owner state;
- [x] duplicate tool-layer Project Memory recovery removed;
- [x] deterministic regression coverage retained/extended for the audited interleavings;
- [x] `pnpm install --frozen-lockfile` PASS;
- [x] Core focused tests `182/182`, check/build PASS;
- [x] Project Memory focused tests `64/64`, check/build PASS;
- [x] full workspace test/check/build PASS;
- [x] `pnpm verify:local` PASS;
- [x] three concurrency-sensitive PM suites repeated 20/20 iterations PASS;
- [x] zero unexpected lock/WAL residue after exercised success/recovery paths;
- [x] bidirectional `@deepseek-ai/dsh-atomic-write` lock interoperability PASS;
- [x] disposable official DSH `0.1.2-alpha.1` runtime validation at exact upstream commit PASS;
- [x] independent Gemini follow-up code review found no new blocking Foundation defect;
- [x] durable evidence folded into `docs/verification/README.md`.

Windows remains **NOT TESTED**. Unsupported process-identity seams remain conservative.

Supported DSH generation: `0.1.2-alpha.1` only.

Foundation production DSH peers declare exactly that:

```text
0.1.2-alpha.1
```

The devDependency graph matches, so the alpha.1 claim rests on the whole workspace suite running against alpha.1, not on a one-off probe.

## Architectural overcomplexity disposition

### Simplified and accepted

- [x] duplicate Project Memory recovery at the tool wrapper removed; domain operations remain the single recovery boundary;
- [x] implicit PID/pathname ownership replaced with explicit transaction ids, lock tokens and process identities;
- [x] Core authorization begin/submit/cancel/polling state machine removed entirely, host and client alike, rather than kept inert — a disabled mutation path that still carried a secret-typed prompt channel was a liability, not compatibility;
- [x] `registerConnectionRpcChannel()` `Function.length` rc2/alpha compatibility probe removed together with the rc.2 branch it selected, when the peer range was narrowed to `0.1.2-alpha.1`.

### Intentionally retained

- [ ] Usage invalidation generation token: retain; it fences pre-invalidation observations.
- [ ] Project Memory fixed journal pathname: retain; explicit transaction generation + locking closes the audited cross-generation race without a larger WAL-directory migration.

Do not perform aesthetic Foundation refactors during provider work.

## 2. Codex — THAWED, PENDING RE-VALIDATION

Independent from-scratch audit, remediation, and live acceptance testing completed:

- [x] independently audit current Codex source/runtime seams against official Codex 0.150.0 and DSH 0.1.1-rc.2;
- [x] reconcile provider-specific DSH dependencies/peers to proven generations;
- [x] remove deprecated feature flags and redundant code-mode-host flags;
- [x] fix stream error on concurrent connection close in App Server connection lifecycle;
- [x] preserve vendor protocol translation and the reviewed Codex App Server adapter boundary inside the provider package;
- [x] preserve registry-first provider registration and canonical `codex-app-server` route;
- [x] preserve absence of vendor-specific subagent registrations/tools;
- [x] focused test/check/build PASS (48/48 tests);
- [x] live primary turn PASS (`test:live:primary`);
- [x] routed native `web_search` PASS (`test:live:web-search`, `test:live:web-search-routed`);
- [x] full 15-scenario live acceptance test suite PASS (`test:live:acceptance`), re-run in full on 2026-08-31 against the current tree at Codex 78 tests, together with `test:live:primary` and both web-search suites;
- [x] prove vendor-native persistent memory/project-doc injection is suppressed;
- [x] prove adversarial isolation against forbidden host capabilities;
- [x] prove zero process residue;
- [x] fresh accepted Codex validation evidence folded into `docs/verification/README.md`;
- [x] stop rejecting producer-supplied context blocks App Server input cannot carry (issue #4). A subagent stopped mid-tool-call put a `tool-call` block into a `user` notice; the plugin threw, which killed the live turn and — with no checkpoint written — every later replay of that session. Those blocks are projected to text instead, at all five sites that handled them. Codex 72 -> 78 tests; `verify:local` exits `0`, live suites not re-run. See *Codex history projection* in `ARCHITECTURE.md` and invariant 31;
- [x] **fixed: a mid-turn route switch into Codex no longer fails the turn.** Found live on 2026-08-31: when a turn's first step ran on another provider and emitted tool calls, the step that consumed those results on `codex-app-server` threw `codex-plugin-dsh: the current Codex turn has no user input`, because current-turn input is decided by position and a tool result is never that input. `prepareCodexHistory` now continues from a pending tail of tool results instead of rejecting it: the results stay in the imported history, where they pair with the `function_call` items of the step that made them, and the turn input is one harness-authored line saying why it looks the way it does. They were briefly sent on both paths as a hedge against `thread/inject_items` being a no-op; that is verified now, so the repetition is gone and the imported history is the single carrier, with `test:live:tool-result-continuation` re-run to confirm the model still reads the result. Codex 78 -> 81 tests, plus `test:live:tool-result-continuation`, a live probe against real `codex-cli 0.150.0` that asserts the model actually saw the tool result rather than merely that the turn survived;
- [x] **the parked-tool-call continuation now checks the history it resumes against.** Found by analogy, not by a test: the same defect had just been fixed in Antigravity's MCP bridge, and Codex's App Server path has the same shape — a turn parks inside `item/tool/call` while DSH's loop executes, so one vendor turn spans several DSH steps. On a continuing step `startTurn` is skipped entirely, and with it every reconciliation it performs: `prepareCodexHistory`, the checkpoint, and the `thread/resume` tip comparison that realigns by rollback, fork or rebuild. What the continuation did check was the model and the tool catalog. Two rewrites already failed loudly — a deleted tool result (`matchingToolResult`) and an assistant or tool message appended after it (`codexDynamicToolResult`) — but a rewrite of the history BEFORE the parked call failed nowhere. The vendor thread still holds the original prefix server-side, so the model resumed reasoning from a history DSH no longer had and its answer was recorded against the new one. The turn now ends instead, which is the whole fix: the next request goes through `startTurn` and realigns there. Narrower than the Antigravity case and self-correcting across turns, so it damages one turn's reasoning rather than a session — recorded that way rather than inflated. Demonstrated before it was fixed: without the guard the regression test's divergent history sails past the continuation and reaches the vendor event loop. Codex 90 -> 92 tests;
- [ ] freeze Codex — reverted: the follow-up Foundation audit found and fixed a Codex defect (raw vendor stderr reaching the model, among others) after this stage was originally frozen on the evidence above. A fresh freeze needs its own validation run against the current tree; see `docs/HANDOFF.md`.

## 3. Antigravity — ACTIVE

Next stage:

- [x] provider-specific audit of source, tests and manifest;
- [x] regression net before changing anything: 7 -> 26 unit tests, driven through the public seam with a fake subprocess, characterizing catalog, vendor-diagnostic and native-tool behaviour;
- [x] route every vendor-process diagnostic through `VendorFailure`; raw stderr and stdout no longer reach a message (30 tests);
- [x] remove hardcoded model-family catalog filtering while preserving malformed-entry rejection. The speculative JSON object-walker was deleted outright — it looked for `slug`/`id`/`model_id` keys the vendor never emits, so the JSON path yielded zero models against the real CLI and the text fallback always ran. Both paths now share one parser over the real `id\tname` format: any id is accepted regardless of family, and rejection is by shape — no tab, empty id, or whitespace inside an id. The `Fetching available models...` progress line is skipped by those rules, not by matching its wording. A non-`SUCCESS` envelope is now an authoritative failure instead of a silent fallback, and its vendor-authored `error` string is sanitized through `VendorFailure` like every other vendor output;
- [x] remove intra-package duplication: `record()`, `nativeToolNames()` and the executable/Windows-shim resolution moved into one internal `src/agy-vendor.ts` and used by both vendor call sites. Justified by a concrete hazard rather than tidiness — Codex once applied its `.cmd`/`.bat` wrap to one invocation path and not the other, and two copies in one package invite the same drift. The two Antigravity copies turned out to be behaviourally equivalent, so no latent bug was found, only removed the room for one. Cross-package extraction into `nishi-dsh-core` was deliberately not attempted: that is an architectural decision nobody has taken;
- **accepted debt — no vendor runtime version verification.** Codex pins `0.150.0` and enforces it from the App Server handshake; Antigravity runs whatever `agy` is installed, at any version. `agy` exposes no handshake, so an equivalent gate would mean parsing `agy --version` and gating on a known-good range. Deliberately not done for now: the maintainer accepted the risk on 2026-08-30. Revisit if a vendor upgrade ever breaks a contract silently;
- **accepted debt — `usage-source.ts` trust model.** It sets `rejectUnauthorized = false` for loopback HTTPS quota probes and discovers the port and CSRF token by scanning process command lines; 534 lines with no unit tests. Any local process that binds the same loopback port with a self-signed certificate would be believed. Bounded blast radius — loopback only, read-only quota reporting — and the maintainer accepted it as-is on 2026-08-30. Revisit if usage ever carries anything beyond quota numbers;
- [x] live acceptance: primary 8/8 (catalog, real turn, tool loop, shared memory, session reopen, model switch, isolation, failure semantics), routed search 1/1, native search 1/1 — all against the real `agy 1.1.22` with no permission-config changes; re-run and still PASS on 2026-08-31;
- [x] reasoning efforts separated from model ids (`5d74408`): a family with two or more effort variants collapses into one advertised model with `low`/`medium`/`high`, the suffixed ids stay as aliases, and invocation maps back to `--model <base> --effort <level>`. A base id resolved without an explicit effort defaults to `high` — the strongest tier, chosen deliberately by the maintainer on 2026-08-31 rather than inherited from the vendor, which states no default;
- [x] that mapping resolves through discovery instead of peeking at the model cache. The cache-peek version silently degraded once `modelCacheMs` had elapsed between route resolution and the turn, and could hand the vendor a suffixed id together with a contradicting `--effort`. Discovery failure still falls back to invoking the requested id verbatim, so a catalog outage cannot lose an otherwise valid turn. Antigravity 62 -> 73 tests, and live primary re-run 8/8 against real `agy 1.1.22` after the change;
- [x] **one live `agy` child per DSH session instead of one process per step.** Every step was a whole process — primary, subagent and routed search alike — which guaranteed a fresh vendor conversation, a guaranteed prefix-cache miss, a cold CLI start in the critical path, and a model reading its own past actions as JSON quoted back at it rather than as its own turns. The vendor already supported the alternative: `--input-format stream-json` runs one turn per NDJSON line, and `--json-schema` is enforced on each of those turns rather than only the last, which was verified against real `agy 1.1.22` before any code was written. Measured on the same binary, a continuation inside one child read 20418 of a 23496-token prefix from cache and paid for ~3.3k new tokens instead of ~23.5k; below roughly 20k of prefix the vendor's cache does not engage at all, so the saving lands where it matters and not on toy exchanges. The adapter keys the child by `sessionId`, opens with a `full` envelope and continues with `delta` envelopes. Reuse is allowed only when the request extends exactly the message ids already delivered; divergent history, a changed system prompt/catalog/model/effort, and any `purpose`-carrying auxiliary call all rebuild instead. Reported usage became a difference rather than the vendor's running conversation total — left unsubtracted it would have re-counted the same tokens once per remaining step and tripped compaction early. Antigravity 73 -> 87 tests, plus a new `test:live:session-continuation` that asserts on real `agy` both that one child served both steps and that the model's answer contains a value only obtainable from the tool result;
- [x] **DSH mints tool-call ids instead of trusting the model's.** The vendor's ids are model-authored and routinely repeated — `call_1` on every step is normal — and nothing upstream rejects a reuse across steps, since the session invariant tracks pending calls only within a step. The result was a history full of results the model could not match to their calls, which is a direct generator of repeated tool calls. The vendor's own id is kept in a per-session map and restored on the wire so the model still recognises its own call;
- [x] **the route advertises a context capacity (`contextWindowTokens`, default `200_000`).** Without one, `compaction-basic` refuses automatic pressure compaction and `agent/pre-step` swallows the refusal as a single warning per target, so an Antigravity session never compacted and had no bound of any kind on its history — unlike Codex, which at least reports `contextWindowExceeded` and ends the turn as `max-tokens`. The figure is deployment-owned rather than discovered: `agy models` discloses an id and a display name and nothing else;
- [x] **the forced output schema now types each tool's arguments.** It declared `arguments: {"type":"object"}` for every call, which an empty object satisfies, so a call carrying none of the tool's required fields was well-formed to the vendor, failed in DSH, and got retried by a model that could not see why. Each variant now pins `name` to one tool and `arguments` to that tool's own schema. `anyOf` plus an `enum`-of-one discriminator was chosen because that is what the vendor's subset accepted when probed on real `agy 1.1.22`, not from its documentation. DSH schemas are rewritten into that subset first: annotations (`format`, `title`, `pattern`, `$schema`) are dropped, `const` becomes a one-member `enum`, and a composite keyword (`$ref`, `oneOf`, `if`) abandons that ONE tool to the old untyped object rather than the whole catalog — a composite cannot be dropped without changing what the schema means, but one exotic tool must not disable typing for its neighbours;
- [x] **live acceptance re-run on the changed tree**: primary 8/8 and `test:live:session-continuation` 1/1 against real `agy 1.1.22`. Search suites not repeated, deliberately — neither change touches the search backend;
- [x] **three defects found by reading real session logs rather than tests**, all of which the session-lived conversation either introduced or exposed. `maxTokens` was refused on every request, so once a context capacity existed compaction ran and failed 35 consecutive times in one session, each failure swallowed by `agent/pre-step` as a warning; it is now accepted and ignored for `purpose`-carrying auxiliary calls only. The divergence check compared message ids, but the tool-result pruner rewrites content while carrying the id over, so 80k tokens pruned in DSH never reached the vendor, which kept serving the originals; the check now digests content. And a delta echoed the conversation's own replies back at it, doubling the density of every action in the transcript -- one session ended with 43 identical `todo_write` calls after the work was already finished. Antigravity 92 -> 96 tests;
- [x] **an auxiliary call may only answer in prose** (`e7d7fe5`). Typing tool arguments in the forced schema regressed compaction, and only once compaction could run at all was it visible. Compaction deliberately replays the conversation's own system prompt and tool catalog so its request stays a genuine prefix of the last routed one and keeps the vendor's cache warm — which, with arguments typed, made the summarization request indistinguishable from an ordinary turn holding 29 tools and a half-finished task. The model answered it with a tool call: `kind` came back `tool_calls`, `text` was empty, and compaction failed with `summarization produced no text summary content` on 7 of 8 attempts in one real session, the single success arriving at step 158 of 175. A `purpose`-carrying request now gets a schema permitting `kind: "message"` with no `tool_calls` property at all — removing the property rather than bounding it makes the wrong answer unexpressible using only keywords the vendor was probed to accept on real `agy 1.1.22`, and the envelope still carries the tools, so the prefix alignment compaction wants is untouched. A reply with no `tool_calls` key is read as an empty list. Antigravity 96 -> 99 tests; the gate and `test:live:session-continuation` both exit `0`;
- [x] **DSH tools through `agy`'s own MCP client — adopted, and the first half landed** (`a42dcc4`). The bridge switches off everything that makes `agy` an agent (`inheritCustomizations: false`, `tools: [finish]`, an ephemeral workspace, forced structured output) and DSH supplies a thinner harness in its place. Reaching the vendor's own harness while keeping DSH's tools means handing them over as MCP tools. Google's own forum thread confirms the shape of the problem this solves: combining tools with a strict response schema is a documented cause of endless identical tool calls, acknowledged by Google staff as the model detecting a conflict between the tool data and the schema constraints. The decisive framing arrived late: this is not a new design but the one `packages/codex` has used since its thread redesign — `codexDynamicTools()` declares the DSH catalog, `item/tool/call` is parked as `active.awaiting`, DSH's loop executes, and the next request resolves the parked call inside the same vendor turn (`adapter.ts:580-620`). `agy` exposes no App Server equivalent, so MCP is the same design reached through the only host-facing door the vendor provides. Four probes against real `agy 1.1.22` fixed the shape:
  - a tool call **blocked for 9.2s completes normally and its result reaches the model inside the same turn** (`num_turns: 1`; the model echoed a nonce obtainable only from the server's reply);
  - an NDJSON line written to stdin **while a turn is blocked is buffered and run as the next turn** — no interleaving, no loss, no error. The blocking bridge and the session-lived child of `8921fd2` therefore do not conflict;
  - **the vendor prefix caches with an MCP catalog in play.** On a 62k prefix every step after the first read ~57.2k from cache and paid ~5.4–5.9k new, *including* the steps immediately following a tool call. An earlier probe's zero cache credit was the ~20k engagement threshold, not the catalog. So the vendor harness's own system prompt and its 57 native tools are a one-off cost per conversation, not a per-step one;
  - **one MCP server process per `agy` process, and its `ppid` is exactly the `agy` pid the adapter spawned.** This was the correlation key — **superseded**, see the socket-and-token entry below; the key is now a token minted before the spawn. It still bounds the exposure below: a server no live adapter claims is served an EMPTY catalog, so a stray `agy` session on the machine gets nothing.
  Two records here were wrong before those probes and are corrected: `num_turns` counts input lines rather than internal turns (one line measured `num_turns: 1` across six internal steps, which are individually visible as `step_update` events carrying type, tool name, arguments, output and per-step usage — enough to record vendor steps in `session.jsonl`), and the objection that the bridge would bypass DSH's permissions was simply false. `ToolsService.execute()` runs the extensible policy pipeline — pre-execute listeners, approval `ask`, guards — and in the chosen design DSH's own agent loop executes anyway, so permissions, hooks and durable history are untouched.
  **Accepted cost:** the server must be registered globally in the user's `agy` configuration, so it is reachable by every `agy` session on the machine. Narrowed, not removed, by the empty-catalog rule above. Registration is deliberately NOT written by this package — vendor configuration stays user-owned the way vendor auth does.
  Landed: the transport-independent half — the adapter-side host, the server process and their protocol (`src/mcp-bridge.ts`, `src/mcp-bridge-server.ts`), with `transport` defaulting to `schema` so behaviour is unchanged and rollback is a one-key config change. Antigravity 99 -> 108 tests, one of which drives the real server process over real MCP stdio and asserts the call stays blocked until DSH answers;
- [x] **the `mcp-bridge` transport is wired into the adapter.** An agent definition allowing `call_mcp_tool` + `finish` and nothing else — the probe's default agent carried 57 native tools and used `view_file` outside the workspace unprompted, so the allowlist is the whole isolation story on this path. `--json-schema` is dropped there, and the `full` envelope omits its tool list, because the catalog now reaches the model as real vendor tools and listing it twice invites the model to describe a call instead of making one. The socket is opened before the spawn (a bridge server connects within milliseconds of its parent starting) and the child claimed by pid after it — the pid claim was later replaced by a token, see below. The turn flow races the open vendor turn against a bridge call: a call becomes a DSH `tool_calls` reply reporting no usage — the vendor has not finished counting — and the next request for that session answers the blocked call from `options.messages` and keeps reading the same turn, writing no new stdin line. The loser of each race is cancelled rather than left registered, since a stale waiter would be handed the first call of some later turn. A turn timeout now scopes the whole vendor turn instead of one DSH step, which it has to: a per-step timeout would kill a child mid-tool. An auxiliary call and a toolless request stay on the schema transport regardless of the flag. `agy mcp list` is consulted for a positive registration check, because the silent failure is worse than a crash — an unregistered bridge hands the model no tools and reads as a disobedient model. Antigravity 108 -> 116 tests, including one that drives a full DSH step pair through the adapter with a fake vendor child and a fake bridge server and asserts that answering a blocked call writes no new vendor turn;
- [x] **live acceptance for the `mcp-bridge` transport PASSES** against real `agy 1.1.22` (`pnpm test:live:mcp-bridge`). The model calls a DSH tool natively, DSH's own loop executes it, the result reaches the model inside the same vendor turn — asserted on a value the model could only have read from the result, never on the exit code — and the whole loop runs in **one** vendor child and one vendor turn. The run found three vendor facts, two of which had been assumed wrong:
  - **`--sandbox` is fine, and stays.** The sandboxed `agy` launches its MCP server normally and `call_mcp_tool` appears in the model's toolset. This was recorded as the load-bearing unknown; it cost zero model tokens to settle, because `init` is emitted before any turn;
  - **naming `call_mcp_tool` in the agent's `tools:` allowlist terminates the agent.** `step_type: "error_message"`, `Agent execution terminated due to error.`, zero tokens, every turn. The identical definition without it runs. This is the obvious spelling of that list and it is fatal, so the reason is recorded next to the constant in `mcp-transport.ts`;
  - **MCP tools are not gated by that allowlist at all.** With `tools: [finish]` and nothing else, the model reached a registered MCP server. So the bridge's agent definition is now byte-for-byte the schema transport's allowlist, and the transport gains no native-tool exposure the shipped one did not already have;
  - one defect found and fixed: the post-hoc `BLOCKED_NATIVE_TOOLS` backstop rejected the finished turn for using `call_mcp_tool`, which on this transport is how a DSH tool is reached at all. Exempted, and only it — covered by a deterministic test asserting that `run_command` in the same position still trips the backstop, because a live-only fix is the weaker signal. Antigravity 116 -> 117 tests;
- [x] **`mcp-bridge` is the default**, decided by the maintainer on 2026-08-31 once acceptance passed. The consequence is deliberate and is a breaking change for deployment rather than for code: a fresh install does nothing until the bridge server is registered with `agy` and granted, and the first turn fails loudly naming the exact command and resolved path. It does NOT fall back to `schema` on its own — a route that silently hands the model no tools looks healthy and reads as a disobedient model, which is the failure the precondition check exists to prevent. `transport: "schema"` remains a one-key change in either direction, and keeps the larger body of live evidence. Every unit test that asserts forced-schema behaviour now pins `transport: 'schema'` explicitly rather than relying on the default, and one test pins the default itself so flipping it back stays a decision;
- [x] **the agent allowlist is enforced — observed, not assumed** (`pnpm test:live:agent-allowlist`). Asked to read a file inside its own granted `--add-dir` workspace, a `finish`-only agent invoked no native tool, produced none of the file's contents, and said outright that it had no filesystem or shell tools; the turn itself still succeeded, so the allowlist restricts rather than breaks. `init.tools` reporting all 57 tools is therefore the CLI's registry and not the agent's effective set — a red herring that reads exactly like an ignored allowlist. This is the first time either transport's prevention half has been observed rather than inferred, and it means the bridge does not rest on the post-hoc `BLOCKED_NATIVE_TOOLS` check alone. Kept as a live regression suite because it asserts a vendor behaviour no unit test can hold;
- [x] **a suspended vendor turn now checks the history it resumes against** (`c8e29d1`). A turn here blocks inside the MCP call, so it spans DSH steps, and rewind, compaction and repair all land in that gap. The resume path answered the blocked call without testing that DSH's history still agreed with what the conversation had been told — a test the schema path has made on every step since it was written. Silent by construction: the model reads a plausible result and continues against a conversation rewritten underneath it. Two interlocking halves, since neither works alone: the sent prefix is now committed on the tool-call outcome as well as the final one (left empty it agreed with everything trivially), and agreement is checked before resolving. Agreement was split out of `extendsConversation` rather than reused whole, so a step that merely repeats the previous request keeps failing by name instead of quietly rebuilding;
- [x] **the transport's own state stopped duplicating itself** (`2d8c6d3`). `bridgePending` recorded what the bridge channel already exposed as `pending()`, kept apart only by a separately-minted DSH id; the server now mints `agy-mcp-<uuid>` and it crosses into DSH verbatim. A UUID and not a counter: a changed signature rebuilds the child inside a live session, restarting a counter into ids already written to durable history. `inFlight` and `turnAbort` became one `openMcpTurn` — a turn's promise and its cancellation have identical lifetimes here, and separating them let a step end holding one without the other;
- [x] **the bridge is addressed by socket and one-shot token instead of by parent pid** (`93cd1c7`). The whole scan-and-claim apparatus existed for one reason: the adapter learned its child's pid only *after* spawning, so a hello could arrive before its channel was registered and the host had to park it. A probe against real `agy 1.1.22` — costing nothing, since MCP servers start before any stdin — settled that the vendor passes its environment to them **verbatim** (95 keys in, 95 keys out, nothing injected or dropped) and that `agy mcp add --env` **merges** rather than replaces. So a token minted *before* the spawn and passed through the environment removes the ordering problem outright, and with it `earlyHellos`, the claim window, both hold timers, `listAdapterSockets`, `findAdapter`, `firstClaim` and the multi-socket offer fan-out. The same probe bounds it: that environment reaches **every** MCP server the vendor launches, third-party ones included — a probe declaring no environment of its own still read a planted variable. So the token binds exactly once. A second claimant is refused outright, and an impostor winning the race gets the real server refused and the turn failing loudly, never a third party quietly served DSH's tools. Correlation by pid was not kept as a second factor: co-resident servers share the parent, so it distinguishes nothing the token does not. Two fail-closed binding tests were written before the implementation; live-verified afterwards on real `agy 1.1.22`;
- [x] **the schema transport has its own module** (`a43abe2`). `antigravity-primary.ts` held both transports inline at 2125 lines while the MCP one already had `mcp-transport.ts`; the structured-output machinery moved to `schema-transport.ts` and the pair is symmetric. A pure move, verified as one — all ten moved declarations byte-identical to their previous versions. 1794 lines left. The schema transport is not on its way out: it needs no setup where `mcp-bridge` needs a once-per-machine registration, and it stays the only route auxiliary and toolless requests take;
- [x] **decided: the bridge's shape does NOT move to Core — its invariant does.** Taken 2026-09-01, once the same defect had been found in both providers and the question had a third data point instead of two. It turned out to be two questions with different answers.

  The **mechanism** stays where it is. The two implementations diverge irreducibly: Antigravity's conversation lives inside the child and is fed to it as NDJSON envelopes, Codex's is a server-side thread with checkpoints; divergence is recovered by killing and rebuilding the child on one side and by resume/rollback/fork on the other; the parked call arrives over a separate MCP server process on one and the same JSON-RPC connection on the other; and the "request shape" guard is one hash on one side and two separate equality checks on the other. An abstraction over that has to be parameterized on every one of those axes, which makes it a worse version of both. Core's charter is also registry, usage, web search, runtime and client surfaces — it holds no notion of a turn or a history, so this would open a new concern rather than fill an existing one.

  The **invariant** does move, to §5. That is the answer the evidence actually supports: neither occurrence of the defect was caused by the absence of shared code, and shared code would not have prevented either — a helper is as easy to not call as a check is to not write. What both providers needed was the rule written down where a provider author looks.

  Deliberately NOT extracted with it: the message-digest function, which is genuinely duplicated and genuinely identical (five lines, same `[id, role, content]` basis, written twice within one session). Two call sites of a five-line function is not an abstraction, and the failure mode worth guarding is the two drifting apart in MEANING, which the invariant pins directly.

  **Revisit when the Claude primary route lands.** Claude is a usage-only stub today with no `LlmAdapter` at all, so the third instance is planned rather than real, and the rule this repository already recorded still holds: two examples differing in transport are thin evidence for inventing an abstraction. A `claude -p` primary route over MCP would very likely have the same shape, and at three real call sites the right form will be obvious instead of guessed. Two standing constraints also argued against moving now: *Do not perform aesthetic Foundation refactors during provider work*, and all four packages being THAWED pending independent validation, where a Core change widens the surface that validation must cover for a five-line saving;
- [ ] **open — a real context window for Codex.** Codex discloses no `context.contextWindow` either, so its automatic pressure compaction is equally dead; it is less severe only because its overflow backstop exists. Deliberately not fixed by guessing: a per-`gpt-5.x` figure needs evidence or a maintainer decision, not an adapter default;
- [x] **adversarial review of the bridge change set, by a model that did not write it** — 3 findings, all confirmed, all fixed. The blocking one is worth naming here because it defeated the property the transport was most confident about: a bridge server registered with the vendor but NOT granted made the vendor launch it, the adapter claim it, and the MCP tools be absent from the model's toolset with no denial event. Measured live in that state, the model listed its tools as `manage_task, schedule, send_message, finish` and the turn returned an empty string with `status: SUCCESS` — silent degradation on a route that looked healthy. The precondition now reads the vendor's grants (read-only; an unreadable config counts as unknown, never as absent) and refuses up front, a `disabled` server refuses too, and a finished turn whose bridge never attached fails loudly, which is the half no precondition can see. Also fixed: a post-startup error on the listening socket would have taken the host process down, and a parked hello leaked its entry and timer. Antigravity 118 -> 123 tests. Raw report and method in `docs/verification/gemini/LATEST.md`;
- [ ] freeze Antigravity.

## 4. Claude

Claude remains usage-only for rc.3.

- [ ] provider-specific DSH compatibility audit;
- [ ] remove genuinely provider-neutral duplication where applicable;
- [ ] focused test/check/build;
- [ ] official CLI usage-source smoke;
- [ ] confirm descriptor remains model-route/search-free;
- [ ] freeze Claude.

## 5. Repository-wide provider invariants

- [ ] provider packages use shared `registerProvider()`;
- [ ] **a vendor turn that spans DSH steps never resumes across a rewritten history.** Both providers park a vendor turn inside a tool call while DSH's own loop executes, so one vendor turn spans several DSH steps — and everything that rewrites DSH history lands in exactly that gap: compaction, the tool-result pruner, repair, a user rewind. The same defect was found in both, months apart in the code and minutes apart in the reading, so it is recorded here as a rule rather than fixed twice and forgotten. A provider whose vendor turn spans DSH steps MUST:
  1. record the history prefix the turn was opened against;
  2. refuse to resume when the current request no longer agrees with that prefix — agreement being a prefix match, and growth being a separate question from agreement;
  3. treat DSH's history as authoritative on recovery, rebuilding or realigning the vendor conversation from it rather than continuing on a guess;
  4. digest a message by `[id, role, content]` — by CONTENT, never by id alone. DSH rewrites a message's content while carrying its id over (the tool-result pruner does exactly that), so an id-only comparison reports agreement across a rewrite that changed everything the model reads.

  Conforming today: `antigravity/src/antigravity-primary.ts` (`agreesWithConversation`, checked before answering a blocked MCP call) and `codex/src/codex-plugin-dsh/adapter.ts` (`historyDigests`, checked before resuming a parked dynamic tool call). The digest function is deliberately duplicated rather than shared — see the decision in §3;
- [ ] vendor-specific subagent registrations/tools remain absent;
- [ ] Core remains independent of provider packages;
- [ ] model capability always has at least one canonical route;
- [ ] capability absence remains legal;
- [ ] synthetic fourth-provider extension remains green;
- [ ] DSH dependency declarations match package-specific validation evidence.

## 6. Product-level live acceptance

- [ ] Codex primary + Project Memory + routed search;
- [ ] Antigravity primary + routed search;
- [ ] Antigravity model switch in one conversation;
- [ ] Codex -> Antigravity provider switch in one session;
- [x] cross-route delegation: a child on the other vendor's primary route, both directions, plus two concurrent Codex children (see §7c);
- [ ] memory written before the switch is readable after it;
- [ ] Usage & Limits with all providers mounted;
- [ ] late/absent provider browser behavior;
- [ ] vendor sign-in stays in each vendor's own CLI, with no Core surface reading or mutating a credential record. Model Accounts was removed outright in rc.3, so this is a check that nothing reintroduced it, not a check that it works.

Automatic failover remains deferred.

## 7. Install/profile lifecycle

- [ ] fresh disposable rc.3 tarball install;
- [ ] same-profile reconciliation/update;
- [ ] preserve unrelated existing links/state;
- [ ] managed Orchestrator preset install/status/update/remove;
- [ ] Suite removal preserves unrelated profile/session/project/vendor state.

## 7a. Codex thread handling — decision taken and implemented

Measured against real `codex-cli 0.150.0`; the numbers and the protocol facts are in `ARCHITECTURE.md` under *Codex vendor threads*.

The former fork-per-turn design got **zero** prompt-cache credit on every turn, while resuming one thread gets cache credit for ~90% of input, and a partial `thread/rollback` does not disturb it. Forking also left one persisted vendor thread per DSH message in the user's own vendor account, each carrying that turn's runtime context and project contract.

- [x] decide whether to replace fork-per-turn with `thread/resume` plus `thread/rollback` for divergence, and implement it (`perf(codex)!: resume the vendor thread instead of forking every turn`). An ordinary turn resumes; `thread/rollback` realigns when DSH's history has diverged from the vendor thread's tip; `thread/fork` is kept only for a checkpoint that is neither the tip nor an ancestor of it. This keeps the cache, keeps exact-turn semantics, and leaves one vendor thread per session instead of one per message. Codex 61 -> 69 tests; `verify:local` and live acceptance (primary + full 15-scenario suite) pass;
- [x] record the reason for the chosen thread strategy in the code — the shared start/fork/resume configuration and the resume/rollback/fork decision are now commented at the call site in `packages/codex/src/codex-plugin-dsh/adapter.ts`;
- [x] decide whether this suite should clean up the vendor threads it creates (`thread/delete` / `thread/archive` exist). Decided: no. Deletion touches data in the user's vendor account and the maintainer has said old sessions do not matter, so no cleanup is implemented and none is planned against previously created threads. Threads created before this change (one per message, under the old fork-per-turn design) still exist in the user's vendor account exactly as they were;
- [x] **`thread/inject_items` reaches the model — verified** (`pnpm test:live:inject-items`). It had always succeeded while being invisible through both `thread/read` and `thread/resume`, so its effect was unknown, and the adapter depends on it for every message that follows a checkpoint. The probe shapes one request so a value can only have arrived by injection: `prepareCodexHistory` splits at the last run of user-authored messages, and a tool-result message is not user-authored, so a history ending `tool-result(SECRET), user(question)` puts the secret in the injected half and the question in the input half with no overlap. Both halves are asserted rather than trusted — the suite sniffs the JSON-RPC written to the vendor and checks the secret is in the one `inject_items` frame and absent from the one `turn/start` frame — and only then reads the answer, which was exactly the secret. No checkpoint is needed for the probe, which is why it costs one turn.

Note on cost framing: the measurements are token counts the vendor reports. ChatGPT/Codex subscription limits are message-weighted rather than token-metered, so a large cached-token saving does not automatically translate into the same saving on the user's `5h`/`Weekly` counters. Do not promise that it does.

## 7b. DSH support boundary — alpha.1 only — DONE except the upstream blocker

`0.1.2-alpha.1` is the only supported DSH generation, and the repository now says so everywhere rather than only in policy.

- [x] Foundation devDependency/test baseline moved from rc.2 to alpha.1, resolved from the local upstream checkout through `pnpm-workspace.yaml` overrides;
- [x] Core and Project Memory peers narrowed to `0.1.2-alpha.1`;
- [x] provider peers (`codex`, `antigravity`, `claude`) moved to `0.1.2-alpha.1`, each on its own evidence — Codex 81 unit tests plus the full 15-scenario live acceptance suite, re-run on 2026-08-31 when the package stood at 78 tests, Antigravity 73 unit tests plus 10 live scenarios (8 primary, 1 native search, 1 routed search), Claude 6 unit tests only and correspondingly weaker;
- [x] the Suite's `dsh-authorization` dependency and `DSH_COMPATIBILITY_VERSION` moved;
- [x] `registerConnectionRpcChannel()`'s `Function.length` arity probe removed with the rc.2 branch it selected; the named seam stays because it records that Connection owns the disposer;
- [x] Core's retired rc.2 dev fixtures (`dsh-client-runtime`, `dsh-host-apiproxy`) dropped; the invariant that they stay out of `dependencies`/`peerDependencies` and out of production imports remains;
- [ ] **blocked on upstream**: publish `0.1.2-alpha.1` to npm. Until then the declared ranges are uninstallable from the registry, which gates publication rather than development;
- [ ] once published, replace the local-checkout overrides in `pnpm-workspace.yaml` with ordinary registry versions and delete the *Local setup* note in `docs/README.md`.

Three rc.2 literals survive on purpose, all of them historical facts rather than compatibility claims: the migration-baseline line in the repository-root `THIRD_PARTY_NOTICES.md`, the provenance line in `packages/codex/THIRD_PARTY_NOTICES.md`, which records what the code was derived from, and a comment in `packages/suite/cordis.patch.yml` describing an rc.2 launcher bug. That second one is worth re-checking: if alpha.1 preserves third-party preset roots, the Suite's managed preset bridge is obsolete and should be removed rather than carried forward.

## 7c. Subagent model routes — composed, live validation pending

Any registered primary route is usable as a subagent model, the Suite's own included, because a spawned child is an ordinary DSH agent reaching its model through `ctx.llm`. See *Subagent model routes* in `ARCHITECTURE.md`.

- [x] Orchestrator preset mounts `subagent` with `modelSelectionSettings: true`, so a child may run on a route other than its parent's. `subagent_fork` deliberately keeps it off (KV Cache reuse of the inherited prefix). Covered by `packages/suite/test/preset-delegation.test.ts`; Suite 12 -> 16 tests;
- [x] the Suite bundle patch continues to leave `@deepseek-ai/dsh-tool-subagent/model-selection-settings` to the surrounding profile — it is a host singleton and the official web-app bundle mounts it. Asserted by the same test;
- [x] **live** (2026-08-31, real `web` profile): one delegation each way — parent `codex-app-server/gpt-5.6-sol` -> child `antigravity-cli/gemini-3.7-flash-medium`, and the reverse. Each child's route is evidenced by its own session `request/header`, and the parent's sampled `subagent/model-selection-policy` event is in its log;
- [x] **live**: one parent turn with two concurrent background children on `codex-app-server`, both settled and reported. Six concurrent `codex app-server` processes at peak, no residue after the run;
- [ ] a child's own `web_search` route and its project-memory access were not asserted separately in that run — the children were deliberately told to use no tools. Worth one more delegation that makes the child search;
- [x] `antigravity-cli` now advertises reasoning efforts, so a child can pick one. It did not when this list was first written — the vendor encodes effort in the model id, and the catalog was passed through as three separate models. `feat(antigravity): separate model reasoning efforts` collapses each family into one model advertising `low`/`medium`/`high`; see *Antigravity model catalog and reasoning efforts* in `ARCHITECTURE.md`. Note for allowlists: the catalog advertises base ids only, so an entry naming a suffixed id no longer shows up in `list_subagent_models`;
- [ ] decide on a dynamic allowlist. The user setting is a static list of exact provider/model pairs, so a vendor's new model is not selectable until the user authorizes it. A drop-in `subagentModelSelection` service publishing the live `ctx.llm` catalog and refreshing on `llm/adapters-updated` would remove that step, at the cost of weakening a deliberate authorization boundary over someone's subscription quota. Not implemented; the maintainer chose the composed-and-documented path on 2026-08-31.

## 8. Release gate

- [ ] final `pnpm install --frozen-lockfile`;
- [ ] `pnpm verify:local`;
- [ ] `pnpm smoke:vendor-cli`;
- [ ] `pnpm verify:bundle-install`;
- [ ] `pnpm check:npm-names`;
- [ ] `RELEASE.md` updated with final evidence;
- [ ] breaking changes reviewed;
- [ ] explicit maintainer publication approval.

Current release state: **NOT READY TO PUBLISH**.

## Deferred after rc.3

- Personal memory store under `$DSH_HOME` with hard separation from repository memory.
- Real Grok provider plugin.
- Decision on guarded `memory_delete` vs rewrite/edit-only pruning.
- Stronger Antigravity native-memory/tool enforcement if vendor APIs allow it.
- Windows acceptance before any Windows compatibility claim.
- Core's `tsdown` build is not reproducible: two builds of an unchanged tree emit a different `lib/client.js`, differing only in CSS-module key order. Harmless today, but it makes byte-level artifact comparison useless.
