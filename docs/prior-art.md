# Prior art: how other tools drive vendor CLIs, and what changes here

Surveyed 2026-09-03. This exists because three independent projects have now solved parts of what this suite solves, and because the survey produced items worth acting on rather than only reassurance. It is background, not a contract: nothing here describes shipping code. Where a finding becomes work it is recorded in `ROADMAP.md`; where it becomes a vendor fact it is recorded in `verification/*-cli-contract.md`.

Two things this document is not. It is not a competitive analysis — product positioning lives in `RELEASE.md`. And it is not authority: every external claim below is a reading of someone else's published code or documentation, not of a running system, and none of it has been probed.

## Three ways to drive a vendor CLI

The field divides cleanly, and the division explains almost every difference in the details.

| Tier | How | Who |
|---|---|---|
| 1 | **Screen-scrape a TUI** over PTY/tmux | `awslabs/cli-agent-orchestrator` (both `agy` and `codex`), `herdr`, `claude-squad` and most of the ~100 entries in `awesome-agent-orchestrators` |
| 2 | **Speak the vendor's structured protocol** | `vibe-kanban` (Codex only), anything on the Agent Client Protocol, and this suite |
| 3 | **Impersonate the vendor's own client** — OAuth as if you were the CLI, then serve an OpenAI-compatible API | `CLIProxyAPI`, `CC-Router`, `codex-proxy`, the Copilot proxies |

This suite is tier 2 for both providers, and is the only surveyed project using `agy --input-format stream-json`. Everyone else in tiers 1 and 2 scrapes Antigravity's terminal.

### What tier 1 actually costs, in their own words

Recorded because it is the concrete answer to "why not read the TUI", and because the answer is not obvious until you read someone doing it.

`awslabs/cli-agent-orchestrator` drives `agy --dangerously-skip-permissions` with the system prompt injected via `-i`, determines state by matching the footer (`esc to cancel` → processing; `? for shortcuts` → idle or completed depending on a turn counter), and needs **pyte terminal composition** because "agy overwrites the footer in place with cursor moves" and a raw pipe therefore reports a stale state. The answer text is extracted between the last echoed `> <query>` line and the next separator, filtered against banners, spinners, thought-process headers, tool-call markers, tips and survey interstitials. MCP servers are registered by writing `~/.gemini/config/mcp_config.json` under keys of the form `name-terminal_id`, serialised by a threading lock, with stale entries from crashed terminals garbage-collected at startup. Its Codex provider is the same approach: `--yolo`, `--no-alt-screen`, `--disable shell_snapshot`, `-c` TOML overrides, developer instructions written to a temp file and substituted with `$(cat …)` to stay under tmux's ~4 KB line limit, and state read from `›`/`•`/`• Working (Xs • esc to interrupt)`. It notes that modal detection is structural rather than title-driven "since title variants exceed what's documented".

Six things make that approach unavailable here, and they are worth stating because none of them is aesthetic:

1. **A step must return a decision, not text.** A step here ends as `CodexDecision` — a tool call with parsed arguments, or a final message — and for Antigravity as a schema-bound reply whose every call variant pins one tool and that tool's own parameter schema. A rendered screen shows `• Called server.tool(…`, from which typed arguments are already gone. `messageDigest` is worse off still: it digests `[id, role, content]`, and a rendering has neither ids nor roles.
2. **The boundary between model content and vendor chrome becomes a regular expression.** Here it is a field (`response`, `structured_output`), and invariant 11 keeps vendor-authored prose out of diagnostics, DTOs and the model. A scraper must separate the two by filter, and whatever the filter misses becomes the assistant's answer.
3. **It is the maximum form of the contract exposure this repository just removed.** `mcp-bridge` was deleted partly because four load-bearing behaviours were observed-only. A footer regex and a composited viewport depend on rendering, which vendors change without a changelog entry — and the version policy here is a floor rather than a range precisely because `agy` is user-installed and self-updating.
4. **Isolation and scraping are mutually exclusive.** A scraper cannot gate a dialog, only auto-answer it, which is why tier 1 runs `--dangerously-skip-permissions` and `--yolo`. The posture here is the opposite: ephemeral workspace, `tools: [finish]`, `--sandbox`, `--add-dir`, with tools and permissions owned by the DSH loop.
5. **The numbers compaction depends on are absent.** `usage` accumulates per conversation and the adapter subtracts; what is needed is uncached input against `cache_read_tokens`. The TUI offers a credits statusline, which is a different quantity.
6. **It is not unit-testable in the way this tree requires.** Focused tests drive the adapter against a fake context and each defect is pinned by a test that fails when its fix is reverted. A scraper's tests are fixtures of rendered screens, which test the fixture.

The honest counterpoint is narrow and real: **quota**. `/usage` and `/credits` are the vendor's *published* channel and the protocol offers nothing (`verification/agy-cli-contract.md`, findings 5 and 7), so a scraper gets quota for free from a terminal it already reads. That single asymmetry is the reason quota here goes through a private loopback RPC, and it is tracked as work rather than as a defect.

## Claudexor: the closest thing to this suite

`razzant/claudexor` — TypeScript/Node, a daemon over a Unix socket, driving Claude Code, Codex, Cursor, OpenCode and Antigravity through their own CLIs. It is the only surveyed project that has both a session-continuity model and a subscription model, and the comparison is the most useful one in this document.

| Claudexor | Here |
|---|---|
| `thread` | DSH session |
| `harness` | route (`codex-app-server`, `antigravity-cli`) |
| `credential profile` | — nothing |
| lane = `(thread, harness, profile)` | `(sessionId, route)` |
| lane home directory on disk | `CodexReplayState` carried in DSH history; live child plus `sentDigests` for Antigravity |
| continuation packet as `context/THREAD.md`, LLM-summarised past a byte budget, cached by `(thread, collapse-boundary turn)`, always disclosed with a `summarized` flag | `delta` envelope, or the post-checkpoint slice plus `thread/inject_items` — lossless, so there is nothing to disclose |
| serial per-thread enqueue | per-session in-flight guard, refusing a concurrent request at the door |
| **no prefix or digest check** — continuity from lane binding and ordering | `prefixDigest` / `sentDigests`, by content |
| read-only asks resume the lane's native session | auxiliary calls isolated to a throwaway child |
| re-verifies every cached session against the resolved account | — nothing |
| harness runs its own loop; a vendor turn is atomic | DSH *is* the loop, hence §7d |

Two readings matter more than the table.

**The divergence gap is structural, not sloppy.** Claudexor owns its threads, so nothing rewrites history behind a harness and ordering suffices. This suite does not own history — compaction shadows nodes, the tool-result pruner truncates, repair injects synthetic results, the user rewinds — and the digests are the price of that. Neither design is more careful than the other; they answer different questions.

**Its credential dimension is the one thing this suite has nothing for, and the lesson is cheap to bank.** Claudexor gives each profile a scoped HOME, has no user-settable "active" account (only an `enabled` toggle), routes an unpinned run to the freshest-headroom account, ranks unknown-quota accounts after known headroom but before exhausted ones, reads quota from Anthropic OAuth usage endpoints, Codex's `/quota` and an Antigravity quota command, never reports an unknown cost as `$0` (a run ends `cost_unverifiable`), and re-verifies a cached vendor session against the resolved account so a pool switch starts fresh instead of resuming a sibling's. See `ROADMAP.md` §5 for the one item worth taking from that today.

## The Agent Client Protocol

`agentclientprotocol.com` — JSON-RPC between an editor and an external agent. Relevant not as a dependency but as a vocabulary, because it names things this suite currently collapses.

- **Five stop reasons**: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`. Compare `agy`'s seven published statuses, six of which this tree currently collapses into one boolean.
- **Cancellation must settle as a value.** On `session/cancel` the agent MUST answer the pending `session/prompt` with `cancelled`, and MUST catch internal errors so a cancellation never reaches the client as a failure. Cancellation as a result, not an exception.
- **`session/load` replays the whole conversation** as `session/update` notifications before returning, because in ACP the *agent* owns history. That is the inverse of this suite, and it names a blind spot rather than a borrowable: `sentDigests` and `prefixDigest` record what we sent, never what the vendor believes it holds, and no probe-free way to compare them exists. Claude Code's `--replay-user-messages` is the closest any of our three vendors comes.
- Tool calls progress `pending` → `in_progress` → `completed` with intermediate updates.

As a transport it is closed to us and closed deliberately: the official `claude-agent-acp` wraps the Claude Agent SDK, which would make `@anthropic-ai/*` a runtime dependency the Claude package's boundary forbids, and `claude-code-cli-acp` reads Claude's transcript JSONL, which is a vendor session store. Recorded so that "the ecosystem standardised on ACP and we ignored it" is answered by a reason rather than by silence.

## Where this tree is ahead, and why that must not be quietly undone

- **`vibe-kanban` drives Codex through the same door and forks every follow-up.** Its executor spawns `codex app-server` under a JSON-RPC peer — our transport — then calls `thread_fork` for each follow-up. Measured here on real `codex-cli 0.150.0`: fork yields **0** cache credit on every turn of a five-turn run, resume yields ~3840 of ~4200 (`ARCHITECTURE.md`, *Measured vendor behaviour*). The most mature orchestrator in the field is on the design this tree abandoned with numbers.
- **Version policy.** `vibe-kanban` pins `npx -y @openai/codex@0.124.0` exactly. This tree deliberately moved from an exact pin to a floor, because a user-installed self-updating binary makes an upper bound refuse every good release while still trusting a bad patch inside the range. Claude Code's `system/init.capabilities` is a better instrument again, aimed at the same problem.
- **Nobody else checks history divergence by content.** Claudexor is the only other project with any continuity model, and it has no digest. This is not over-engineering; it is what not owning the history costs.

## Items taken from this survey

Each is recorded as work where it belongs, not here:

| Item | Where |
|---|---|
| Typed turn settlement over `agy`'s seven statuses; cancellation as a value | `ROADMAP.md` §5 |
| Declared per-route capability flags instead of prose asymmetry | `ROADMAP.md` §5 |
| Quota without a prior turn, from a throwaway child's own listener | `ROADMAP.md` §3 |
| Vendor-side trajectory trimming as an unguarded divergence direction | `verification/agy-cli-contract.md`, finding 9 |
| Quota-surface enumeration, the `FetchQuotaStatus` siblings, slash interception, the Codeium lineage | `verification/agy-cli-contract.md`, findings 7-11 |
| The whole Claude Code primary-route contract and its terms | `verification/claude-code-cli-contract.md`, `ROADMAP.md` §4 |

## External sources

Read on 2026-09-03. Repository contents and documentation only; nothing was executed.

- `github.com/razzant/claudexor`, and `docs/ARCHITECTURE.md` therein
- `github.com/BloopAI/vibe-kanban` — `crates/executors/src/executors/{mod,codex}.rs`
- `github.com/awslabs/cli-agent-orchestrator` — `CODEBASE.md`, `providers/{antigravity_cli,codex}.py`
- `github.com/router-for-me/CLIProxyAPI`, and its `config.example.yaml`
- `github.com/steipete/CodexBar` — `docs/antigravity.md`
- `agentclientprotocol.com` — `/protocol/{overview,prompt-turn,session-setup}`
- `github.com/andyrewlee/awesome-agent-orchestrators`, `github.com/ogulcancelik/herdr`, `github.com/smtg-ai/claude-squad`
- `code.claude.com/docs/en/{headless,legal-and-compliance}`, `antigravity.google/docs/cli/{credits,commands/usage}`
