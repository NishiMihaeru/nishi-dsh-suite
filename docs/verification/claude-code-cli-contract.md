# The Claude Code CLI contract, and the terms that bound a primary route

Read on 2026-09-03, **before any primary-route code exists**. This is a pre-implementation contract read in the same form as `agy-cli-contract.md`, not a record of shipping dependencies: `packages/claude` is usage-only today and depends on exactly one surface (a short-lived `stream-json` control session issuing one `get_usage`). Everything below describes what a primary route *would* rest on, so the decision can be argued before it is written rather than after.

Read against the installed build:

```text
claude 2.1.246 (Claude Code)
```

## Sources, and what each one is worth

| Source | Worth |
|---|---|
| `claude --help` on the installed 2.1.246 | Highest for flag existence and wording. It is the binary actually in use, the way `codex app-server generate-json-schema` is for Codex |
| `code.claude.com/docs/en/headless` | The vendor's own page for `claude -p`, naming it a supported programmatic interface. Carries behaviour the help text does not — signal handling, background-task grace, stream event shapes |
| `code.claude.com/docs/en/legal-and-compliance` | The governing published terms for running Claude Code inside another product. **This supersedes the 2026-08-31 support-chat basis entirely** |
| `code.claude.com/docs/en/cli-reference`, `/docs/en/agent-sdk/*` | Referenced by the above; not read end to end in this pass |

**Probed on 2026-09-03**, after the first read of this file and before any route code: all five open probes ran against the installed 2.1.246 on `claude-haiku-4-5`, trap 1 was probed against a purpose-built hostile repository, and the eleven results are in *Probe results* below. The inventory now carries measurements where it carried guesses; what is still unmeasured says so.

## The terms, first, because they decide the flag set

Two published clauses settle what was previously an open question, and they are the reason a support-chat citation is no longer needed.

*Can customers offer Claude Code in their products?* — "preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service", subject to conditions.

*Authentication and credential use* — "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above."

So the per-user local-CLI model is the sanctioned shape, by published text. Four conditions bind this repository:

| # | Condition | What it costs us |
|---|---|---|
| 1 | The distributor must agree to the Commercial Terms of Service | A maintainer action before publication, not a code change. End-user usage still bills under the end user's own agreement; the page contemplates both |
| 2 | Binary unmodified; no built-in authentication method may be removed, disabled or restricted — "including methods that permit signing in with a Claude account" | **`--bare` must never be passed.** It "never reads OAuth credentials or the system keychain", so it breaks subscription auth functionally *and* touches the one prohibited dimension. The vendor calls it the recommended mode for scripted/SDK calls and says it **will become the default for `-p`**, so the route needs an explicit opt-out and a test that fails when the default flips |
| 3 | No paying for, reselling or intermediating usage; no collecting, storing or intermediating Claude.ai credentials or session tokens; sign-in completes through Anthropic's own flow | Already this repository's hard constraint. It also rules out any login helper, and rules out reading the vendor's credential or transcript stores |
| 4 | "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK" | Not a prohibition. It is the clause that would be cited against many concurrent children, so the concurrency cap has a published reason rather than only prudence |

Name and logo are settled and currently non-compliant in this tree: "you can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo". The npm name `nishi-dsh-claude` and the glyph `iconPath`/`brandColor` at `packages/claude/src/index.ts:79-81` both need changing before publication; "runs the Claude Code CLI" in plain text is the sanctioned phrasing.

This is a reading of published text by the party that wants the answer to be yes. It is not legal advice, and conditions 1 and the rename are maintainer decisions.

## Prospective dependency inventory

Status: **P** published in `--help` or the vendor's own docs; **A** ambiguous; **O** would need a probe; **X** deliberately not used.

| # | Surface | Would serve | Status |
|---|---|---|---|
| 1 | `-p` / `--print` as a supported programmatic interface | the route existing at all | **P** — the vendor's own page is titled *Run Claude Code programmatically* |
| 2 | `--input-format stream-json` + `--output-format stream-json` | one long-lived child per DSH session | **P**, and **MEASURED** (finding 1): one child serves several turns from successive stdin lines, carries history between them, and exits 0 on stdin EOF. The `agy` shape transfers |
| 3 | `--json-schema` | the forced-decision transport, identical in shape to Antigravity's | **P**, and **MEASURED** (finding 2): it binds EVERY turn of a `stream-json` session, implemented as a forced `StructuredOutput` tool. Not the `agy` ambiguity -- there is no staleness window here, because each turn ends in its own tool call |
| 4 | `structured_output` as the field carrying the schema-bound value | reading the decision | **P** — and the same field name `agy` uses, so the existing transport shape transfers |
| 5 | `--tools ""` disabling every built-in tool | the isolation posture; the published equivalent of Antigravity's `tools: [finish]`, with no agent file needed | **P** |
| 6 | `--system-prompt` fully replacing the default prompt | owning the prefix | **P** |
| 7 | `--session-id <uuid>` | **client-minted session identity** — neither Codex nor `agy` offers this; replay state needs no vendor-issued id | **P** |
| 8 | `--no-session-persistence` (print mode) | removing the durable-residue property Codex has and cannot clean up | **P**, and **MEASURED** (finding 5): four-turn continuity held with nothing written to `~/.claude/projects/`. Continuity comes from the live process, and the residue debt Codex carries simply does not exist here |
| 9 | `--mcp-config` + `--strict-mcp-config` | declaring DSH tools per invocation | **P** — and the reason the "irreducible setup" argument that removed Antigravity's `mcp-bridge` does **not** transfer: nothing needs to be written to user-owned global config |
| 10 | `system/init.capabilities` (array of behaviour names, e.g. `interrupt_receipt_v1`) | feature detection instead of version comparison | **P**, v2.1.205+. A strictly better instrument than Codex's version floor, aimed at the same problem |
| 11 | `system/init.mcp_server_errors` / `plugin_errors` | failing loudly when a declared server never loaded | **P**, v2.1.219+ |
| 12 | `system/api_retry.error` typed categories (`authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown`) | precise diagnostics as a **field**, not stderr prose | **P**. This is why a Claude recogniser list can map a published enum instead of guessing at vendor wording the way Antigravity's two-entry list has to |
| 13 | `--replay-user-messages` | per-message acknowledgement that a delivered message was received | **P**, `stream-json` both ways. The nearest thing any of our three vendors offers to "what do you believe the history is" |
| 14 | `--effort low\|medium\|high\|xhigh\|max`, `--model <alias\|full>` | mapping DSH reasoning effort and model | **P** |
| 15 | `--safe-mode` | isolation **with authentication intact** — "all customizations … disabled … Auth, model selection, built-in tools, and permissions work normally" | **P**, and **MEASURED** (finding 3): auth works, but an explicit `--mcp-config` does **not** load under it. Safe mode and an MCP tool path are mutually exclusive on this build |
| 16 | `--max-budget-usd`, and `total_cost_usd` in the `json` envelope | a per-invocation spend bound; client-side estimates by the vendor's own admission | **P** |
| 17 | SIGINT ends the turn; SIGTERM leaves it unfinished with exit 143 and no recorded result, and a later resume continues that unfinished turn | dispose ordering | **P** — documented on the headless page, and it inverts the naive choice: dispose must send SIGINT first |
| 18 | `--bare` | — | **X** — condition 2 above |
| 19 | `--fallback-model` | — | **X** — automatic model substitution mid-work is the defect class the mid-turn route switch already cost this repository |
| 20 | `--dangerously-skip-permissions` | — | **X** — the posture every TUI-scraping orchestrator is forced into, and the opposite of this suite's |
| 21 | `rate_limit_event` on the output stream: `status`, `rateLimitType`, `resetsAt`, `overageStatus`, and `unifiedWindows.{five_hour,seven_day}.utilization` | the usage capability, **published on the ordinary stream** | **MEASURED** (finding 6). No private endpoint, no process scan, no loopback RPC -- the thing `agy` needs row 22 of its own contract for arrives here unasked, twice per turn |
| 22 | `--system-prompt-file` / `--append-system-prompt-file` | a prefix larger than one argv slot | **MEASURED** (finding 7). Absent from the `--help` option list, named only inside the `--bare` blurb, and real: it validates the path and exits 1 with the reason on stderr. Required, not optional -- `--system-prompt` dies with `E2BIG` past ~128 KiB |
| 23 | `system/init` re-emitted at the head of EVERY turn, never before the first stdin line | capability and tool detection | **MEASURED** (finding 1). So `capabilities` cannot be read for free before a turn, and it can be re-read per turn: on this build `["interrupt_receipt_v1","interrupt_cancel_queued_v1","msg_lifecycle_v1"]` |
| 24 | `isReplay: true` on replayed user messages | telling an acknowledgement apart from a tool result, both of which arrive as `type: "user"` | **MEASURED** (finding 8). Without this field the two are indistinguishable by type alone |
| 25 | `terminal_reason` + `subtype` on `result` (`completed`, `aborted_streaming` / `error_during_execution`) | typed turn settlement, including cancellation-as-value | **MEASURED** (finding 10). SIGINT settles the turn and exits 0; SIGTERM emits nothing and exits 143 |
| 26 | `total_cost_usd` and `modelUsage` (with `contextWindow`, `maxOutputTokens`, `canonicalModel`, `provider`, `costBasis`) | cost reporting and declared per-route capability | **MEASURED** (finding 9), with the trap: `total_cost_usd` is CUMULATIVE over the child's life, so a per-step figure is a subtraction -- the same arithmetic the Antigravity adapter already does for `usage` |
| 27 | `apiKeySource: "none"` in `init` under a subscription login | asserting the end user's own credential is what pays | **MEASURED** (finding 6). A cheap, published check that condition 3 of the terms is being honoured at runtime |
| 28 | Automatic prompt-cache breakpoints across the turns of one child | the whole economic case for a session-lived child | **MEASURED** (finding 4). The CLI places them itself: no flag, no cache-control plumbing, ~300 tokens of creation per later turn against an 18k prefix read back in full |
| 29 | `--setting-sources <user\|project\|local>` | the isolation posture, and the reason `--safe-mode` is unnecessary | **MEASURED** (finding 11). `user` alone drops a repository's hooks, its slash commands and its `CLAUDE.md`, while leaving auth, the model and our own `--mcp-config` intact |
| 30 | `--include-hook-events` | seeing repository hooks fire instead of inferring it | **MEASURED** (finding 11). The instrument that made the exposure observable rather than argued: `hook_started`/`hook_response` pairs on the ordinary stream |
| 31 | `DISABLE_COMPACT`, with `--autocompact` at the model's full window as a second belt | keeping DSH's history authoritative | **MEASURED** (finding 12). Documented as "disables all compaction"; without it the vendor collapsed a 116k conversation to 1,091 tokens mid-session |
| 32 | `system/compact_boundary` with `compact_metadata` (`trigger`, `pre_tokens`, `post_tokens`, `cumulative_dropped_tokens`, `preserved_segment`) | the watch that proves the belt held | **MEASURED** (finding 12). For this route its arrival is a failure signal, not an event to render |

## Traps

1. **`-p` executes repository content without a trust prompt.** The vendor's own page: without `--bare`, a `-p` session "runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted", with no workspace-trust dialog and no per-server approval, and settings files that fail validation are silently ignored. A primary route invokes this in the user's own workspace, so the exposure is real and it is ours to close. `--bare` cannot be the answer (condition 2). **Probed and closed (finding 11): the posture is `--setting-sources user` + `--strict-mcp-config` + `--tools ""` + `--system-prompt-file`, and `--safe-mode` is not part of it.** Safe mode closes the same four channels but also kills an explicitly passed `--mcp-config`, so it is strictly worse. The trap's sharpest edge survives the fix and belongs in the code: an invalid settings file is ignored in total silence while every other channel keeps loading, so isolation must live in argv, where a mistake exits 1.
2. **Unfinished turns survive.** See row 17. Killing a child with SIGTERM leaves a turn that a resumed session will continue — a vendor-side analogue of the parked-turn class this repository has now fixed twice.
3. **Background work extends process lifetime.** Background Bash tasks are killed about five seconds after the final result, but background subagents and workflows are waited for, capped at ten minutes of continuous idle by default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). Any grace timeout must account for that, and the isolation posture should make such tasks unreachable in the first place.

## Probe results, 2026-09-03

All five open probes ran, then trap 1, then the vendor's own compaction, and seven findings nobody asked for came out of the arms. Where a knob has a documented domain -- compaction does -- the domain is quoted from the documentation rather than guessed at, because one round of guessing values here measured nothing (finding 12). Shape: `claude 2.1.246`, `claude-haiku-4-5-20251001`, `--effort low`, a sterile workspace outside this repository, and a **scrubbed environment** -- only `PATH`, `HOME`, `USER`, `LANG`, `TERM=dumb`, because this session's own `CLAUDE_CODE_*` variables (including a messaging socket and token) would otherwise be inherited by every child and the probe would measure the harness. Total spend across every arm was well under a dollar. Recipes are not retained as a suite; they are described below.

**1. One `stream-json` child serves several turns, and `init` is a per-TURN event.** Probe 1, answered positively: after the first `result` the process was alive, accepted a second message on stdin, answered it, and exited 0 on stdin EOF. History carried across the boundary -- a codeword planted in turn 1 came back verbatim in turn 2 -- so the session-lived-child design transfers from `agy` intact. Two cadence details the docs do not state: **`system/init` is emitted at the head of every turn, not once per process**, and **nothing at all is emitted before the first stdin line**. A child started and left alone printed zero bytes for twelve seconds and exited 0 on EOF. So `init.capabilities` cannot be read as a free feature probe the way Antigravity's quota listener can be read for free -- detection costs a turn -- but it can be re-read on every turn, which is strictly more than Codex's one-shot version floor.

**2. `--json-schema` binds every turn, as a forced tool.** Probe 2, answered: with `--tools ""` the session's tool list was exactly `["StructuredOutput"]`, and each turn ended with a `tool_use` block calling it. The value arrives twice per `result` -- typed in `structured_output` and duplicated as a JSON string in `result` -- and it arrived on both turns of the same child, so this is not the `agy` staleness class: each turn's decision is bound to that turn's own tool call rather than to a session-wide slot that can go stale. Two consequences for a reader: **`stop_reason` on a perfectly successful schema turn is `"tool_use"`** (with `terminal_reason: "completed"`), so a naive reader that treats `tool_use` as "unfinished" would mis-settle every turn; and a schema does **not** preclude tool calls -- in the control arm of probe 3 the model called an MCP tool, received its result, and then emitted `StructuredOutput`, all inside one turn.

**3. `--safe-mode` and `--mcp-config` are mutually exclusive.** Probe 3, answered negatively, which kills the candidate remedy in trap 1. Under `--safe-mode` with an explicit `--mcp-config` and `--strict-mcp-config`: `mcp_servers: []`, the tool list was `["StructuredOutput"]` alone, and the model reported the tool absent. A control arm, identical but for the flag, connected the server (`{"name":"dshprobe","status":"connected"}`), exposed `mcp__dshprobe__probe_marker`, called it, and returned its marker -- so the configuration was sound and safe mode is the cause. Isolation and an MCP tool path therefore cannot both come from safe mode; for the thin route this costs nothing, because it needs no MCP server at all.

**4. The prompt cache engages by itself across the turns of one child, and this is the finding the design rests on.** Probe 4, with the mistake both other providers taught us to avoid: an 18k-token prefix delivered as a real system prompt, four turns in one child. Measured `usage` per turn:

| turn | `input_tokens` | `cache_creation` | `cache_read` |
|---|---|---|---|
| 1 | 10 | 18,140 | 0 |
| 2 | 10 | 356 | 18,140 |
| 3 | 10 | 345 | 18,496 |
| 4 | 10 | 278 | 18,841 |

The CLI writes its own cache breakpoints -- no flag was passed and none exists -- so a later turn pays ~300 tokens of creation plus ten fresh tokens against a prefix it reads back whole. That is the same monotonic `cache_read` growth the Antigravity contract records as the healthy shape, obtained here without an agent file, a threshold hunt, or a counterbalanced arm order. It also means the earlier arms' `cache_read: 0` was the threshold and not a defect: at ~1k tokens of prefix there is nothing worth caching.

**5. `--no-session-persistence` holds, and without it the residue is predictable.** Probe 5, answered: four turns of continuity with no file anywhere under `~/.claude/projects/`. The control arm, run without the flag, wrote exactly one transcript at `~/.claude/projects/<sanitised-cwd>/<our-uuid>.jsonl` -- and because row 7 lets us mint the UUID, that path is known in advance rather than discovered afterwards. Continuity therefore comes from the live process, exactly as row 8 predicted, and the durable-residue debt Codex carries is optional here rather than inherent.

**6. Usage is published on the ordinary output stream -- twice per turn, unasked.** Not a planned probe. Every turn emitted `rate_limit_event` before and after the model call, carrying `status`, `rateLimitType: "five_hour"`, `resetsAt`, `overageStatus` with `overageDisabledReason`, `isUsingOverage`, and `unifiedWindows` with a `utilization` fraction and its own `resetsAt` for both `five_hour` and `seven_day`. This is the surface `agy` needs a private loopback RPC and a `/proc` walk to reach and that Codex needs a separate read session for, and Claude Code hands it over on the same pipe as the answer. `init` additionally reports `apiKeySource: "none"` under a subscription login, which is a runtime check that the end user's own credential is what pays -- condition 3 of the terms, observable rather than asserted.

**7. A large prefix cannot go through argv, and the flag that fixes it is undocumented.** `--system-prompt` with a 175 KB value fails before any API call with `spawn E2BIG`: Linux caps a single argument at `MAX_ARG_STRLEN` (128 KiB) regardless of the 2 MB `ARG_MAX`. `--system-prompt-file` is absent from the `--help` option list and named only inside the `--bare` blurb, but it exists and validates: a missing path exits **1** with `Error: System prompt file not found: <path>` on stderr and nothing on stdout, before any spend. A primary route must use the file form from the start -- a DSH system prompt plus a context block will cross 128 KiB long before it becomes unusual -- and should keep a test on a flag the vendor has not committed to in `--help`.

**8. Two different things arrive as `type: "user"`, and one field tells them apart.** With `--replay-user-messages`, the acknowledgement of a delivered message is a `user` event carrying `isReplay: true`; a tool result is also a `user` event, carrying `tool_use_result` and no `isReplay`. A reader that keys on `type` alone will feed its own replayed prompts back into history as model input.

**9. `total_cost_usd` is cumulative, which is the Antigravity usage bug waiting to happen again.** Across four turns of one child it read 0.0385, 0.0422, 0.0456, 0.0488 -- a running total for the child's life, not the cost of the turn. Any per-step figure is therefore a subtraction between consecutive results, the same arithmetic `packages/antigravity` already performs for accumulating `usage`, and getting it wrong reports every step as costing everything the session has spent. `modelUsage` alongside it names `contextWindow` (200,000), `maxOutputTokens` (32,000), `canonicalModel`, `provider: "firstParty"` and `costBasis: "list"` -- enough to fill a declared per-route capability from the vendor rather than from a constant in our source.

**10. SIGINT settles the turn; SIGTERM erases it.** The vendor documents this and it measures exactly as documented, which is worth knowing given how much else here is undocumented. **SIGINT** mid-turn: a `result` arrives with `subtype: "error_during_execution"`, `is_error: true`, `terminal_reason: "aborted_streaming"`, and the process exits **0**. **SIGTERM** mid-turn: no `result`, no stderr, exit **143**, and the turn simply never happened as far as the stream is concerned. So disposal must send SIGINT first and wait for the settlement, and cancellation is available as a *value* -- the ACP property this tree has admired from a distance, present here without an adapter.

**11. The repository-content exposure is real on four channels, and it closes from argv -- but never from a file.** Trap 1, probed. Not in this repository: it carries no `.claude/`, no `.mcp.json` and no `CLAUDE.md`, so a run here would have proved nothing, and planting a hook in the maintainer's own project config was not an option. The fixture was a purpose-built git repository carrying exactly what the vendor's warning describes -- `.claude/settings.json` with four hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`), each appending to a marker file, plus an `env` block; `.mcp.json` declaring a marker server; `CLAUDE.md` ordering a token into every reply; and `.claude/commands/hostilecmd.md`.

The baseline arm -- `-p` with no isolation flags -- opened all four: the hooks **executed** (marker files for `SessionStart`, `UserPromptSubmit` and `Stop`, and six `hook_started`/`hook_response` events on the stream under `--include-hook-events`), the repository's MCP server **connected** and its tool was offered, `CLAUDE.md` was **obeyed** (the planted token appeared in the reply), the repository's slash command was registered, and the whole built-in tool set was live including `Bash`, `Write` and `Edit`. No trust prompt at any point. The vendor's warning names two of these; there are four.

| arm | isolation flags | repo hooks | repo MCP | `CLAUDE.md` | repo command | our MCP |
|---|---|---|---|---|---|---|
| A baseline | none | **fired** | **connected** | **obeyed** | **registered** | -- |
| B | `--safe-mode --strict-mcp-config --tools ""` | no | no | no | no | -- |
| C | `--strict-mcp-config --setting-sources user --tools ""` | no | no | no | no | -- |
| F | C plus `--mcp-config <ours>` | no | no | no | no | **connected** |
| G | F plus `--safe-mode` | no | no | no | no | **killed** |

Arm C is the answer, and it retires the conflict finding 3 created: **safe mode is not needed for isolation.** `--setting-sources user` alone drops the project's hooks, its slash commands and -- unexpectedly -- its `CLAUDE.md`, which held even in a further arm that kept the default system prompt, so memory discovery is governed by setting sources rather than by the prompt. Arm F then shows the posture is compatible with our own tools: our `--mcp-config` connects while the repository's server does not. Arm G re-confirms finding 3 from the other direction -- safe mode kills an explicitly passed `--mcp-config` too, so it is strictly worse than arm C for every route.

**The asymmetry is the part to carry into the code.** A separate arm replaced the fixture's `.claude/settings.json` with syntactically invalid JSON: the CLI ignored it in complete silence -- exit 0, zero stderr bytes, no warning event on the stream -- and the hooks did not fire, while **every other channel still loaded**: the repository's MCP server connected, its slash command registered, `CLAUDE.md` was obeyed. So the one file that could carry a deny-list is the one file that can vanish without a word, and the executable channels survive its loss. Isolation must therefore be expressed in **argv**, never in a settings file: a bad flag or a missing file path exits 1 with the reason on stderr before any spend (finding 7), and a bad settings file exits 0 pretending all is well.

Two smaller notes from these arms. `init.skills` reported 16 in *every* arm, safe mode included, so the skill count is not an isolation signal -- what makes them unreachable is `--tools ""` removing the `Skill` tool, not the posture. And even with `--no-session-persistence`, the CLI creates `~/.claude/projects/<sanitised-cwd>/memory/` -- two empty directories, no files; the probe removed them.

**12. The CLI compacts the conversation by itself in print mode, and `DISABLE_COMPACT` is the documented off switch.** This was the last thing in this file's design that nobody had looked at: `--autocompact` exists, so a second compactor may sit on top of history DSH treats as authoritative. It does. Probed with a 116k-token prefix and `--autocompact 100000`, three turns:

```text
system/compact_boundary  compact_metadata: { trigger: "auto", pre_tokens: 116640,
                           post_tokens: 1091, cumulative_dropped_tokens: 115549,
                           duration_ms: 18364, preserved_segment: {...} }
```

The turn it happened in took 21 s instead of 3 s and its `usage` shows the collapse. An otherwise identical arm with `DISABLE_COMPACT=1` produced **zero** compaction events, kept `cache_read` at 116,360 on the third turn, and cost $0.041 against the compacting arm's $0.285.

The controls are documented, and this is the part to read rather than probe (`model-config`, `env-vars`):

| control | domain | precedence |
|---|---|---|
| `--autocompact <auto\|tokens>` | `auto`, or 100K-1M | per launch; not preempted by managed settings |
| `/autocompact <value>` | same | writes the `autoCompactWindow` user setting |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | plain token count only | **takes precedence over the command, the flag and the setting** |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 1-100 | can only LOWER the trigger, never raise it |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | token count | on a `claude-` model ID it applies **only when `DISABLE_COMPACT` is also set** |
| `DISABLE_COMPACT` | set / unset | "disables all compaction" |

With no window configured, the vendor compacts when the conversation reaches the model's context limit, and certain model configurations compact at the 200K boundary regardless.

**What the route must do.** Set `DISABLE_COMPACT=1` in the child's environment, and additionally pass `--autocompact` at the model's full window so that if the variable is ever dropped the trigger sits at the ceiling instead of below it. Then treat `system/compact_boundary` on the stream as a hard failure rather than an event: it means the vendor rewrote history behind DSH, and the only correct response is to rebuild the conversation from DSH's own history. This is the same hazard class as Antigravity's trajectory trimming (`agy-cli-contract.md` finding 9) with one difference that matters -- there the vendor's trim is invisible, here it announces itself on the stream, so the watch is cheap and exact.

**A correction that belongs with it.** Two earlier arms set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to 20,000 and 5,000 and saw nothing happen; I read that as the variable being ignored. It is not: the documented domain is 100K-1M, and a value below it does not apply. Likewise `CLAUDE_CODE_MAX_CONTEXT_TOKENS` left `modelUsage.contextWindow` at 200,000 because it is documented to apply to a `claude-` model ID only alongside `DISABLE_COMPACT`. The knob domain was in the documentation the whole time, and guessing values measured nothing.

**13. The prompt cache is shared BETWEEN processes, which rewrites the rebuild economics.** Not planned, and it corrects something already written down. Two separate arms started fresh children with new session ids and the same `--system-prompt-file`, and both paid `cache_creation: 0` while reading back 115,879 tokens that an earlier, already-exited child had created. So a dead child does not cost a full prefix recreation: within the cache TTL a rebuild pays cache reads. Replaying DSH history into a replacement child is therefore cheap -- **as long as the prefix is byte-identical**, which promotes prefix stability (system prompt text, tool list, their order) from a nicety to a property worth a test.

### What is still unmeasured

- Whether the resumed-unfinished-turn half of row 17 reproduces. Testing it requires persistence plus a resume, which means writing to the vendor's session store, so it stayed out of this pass.
- Whether `init.capabilities` ever changes mid-session, and whether `microcompact_boundary` -- a second, narrower mechanism the binary carries -- is also governed by `DISABLE_COMPACT`.
- Anything about a model other than `claude-haiku-4-5`, and anything about a real DSH prefix. Cheap arms answer cheap questions.

### Probe hygiene

Sterile workspace under the session scratchpad, never the repository. Environment scrubbed to five variables, so no `CLAUDE_CODE_*` from this session reached a child. No settings file, global or project, was written or read from the user's home beyond what the CLI does on its own; `~/.claude/settings.json` is untouched (mtime unchanged). The credential store was never opened -- authentication happened through the CLI's own flow, which is condition 3 of the terms and the only sanctioned path. No child outlived its arm. One artefact remains by choice: the control arm of probe 5 wrote `~/.claude/projects/<sanitised-scratch-cwd>/11111111-2222-4333-8444-555555555561.jsonl`, and it was **left in place** rather than deleted, because deleting a vendor session store is exactly what this repository forbids its own code to do; it is the only residue, and it sits under a scratch path no real project uses.

## Consequences

1. **Architecture decision, not yet implemented: the thin route, not the agentic one.** Constrain the reply with `--json-schema`, disable the vendor's own tools, and keep the loop in DSH — one completed vendor turn per DSH step, the same conclusion `ROADMAP.md` §7d reached for Codex. The agentic alternative (Claude Code runs its loop, DSH tools arrive over MCP) makes one vendor turn span many DSH steps, which is the class §5 exists for, and it puts a second compactor on history DSH considers authoritative. MCP stays in reserve rather than rejected: unlike `agy`, it costs no user-owned setup here (row 9), so an agentic mode remains cheap to add later.
2. **The terms are settled and the tree is not compliant yet.** Conditions 1-4 are satisfiable by construction, but the package name and the glyph are not, and both are cheaper to change before publication than after.
3. **The evidence now exists, and it is one-day-old exploratory evidence.** Ten findings on one model in an empty workspace, from arms that are not retained as a suite. That is enough to write the route against and not enough to call it validated: what a live suite must pin, in order, is the per-turn schema binding, the cache shape, the `rate_limit_event` field names, `isReplay`, and the cumulative-cost subtraction -- five vendor spellings whose rename would each silently break a different part of the adapter.
4. **The isolation posture is settled, measured against a hostile repository (finding 11).** `--setting-sources user` + `--strict-mcp-config` + `--tools ""` + `--system-prompt-file`, with `--mcp-config` added only if an agentic mode ever wants it, and `--safe-mode` deliberately absent. All four repository channels -- hooks, `.mcp.json`, `CLAUDE.md`, project slash commands -- close under it, and our own MCP still loads. The rule the same probe produced is the durable part: **isolation belongs in argv, not in a settings file**, because a settings file fails silently while a flag fails with exit 1.
5. **Two upgrades this route gets for free that neither other provider offers, and both should be spent.** Usage arrives on the stream (finding 6), so the Claude route needs no quota harvest at all -- no listener, no `/proc` walk, no polling for a 200. And cancellation is a settled value (finding 10), so `ROADMAP.md` §5's typed-turn-settlement item has a reference implementation to copy rather than a design to invent.
