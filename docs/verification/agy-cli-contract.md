# The `agy` published contract, and what this suite depends on

Written 2026-09-02, after reading the vendor's own documentation end to end rather than reasoning from probe history. It exists because this package has more than once depended on behaviour the vendor never published — the shape of the risk is known from `packages/codex`, where the shipped adapter turned out to rest on an undocumented `dynamicTools` field (`ROADMAP.md` §5, §7d).

This file is a **contract inventory**, not a design document. Every row says where a dependency stands with the vendor: published, ambiguous, observed-only, or not a CLI surface at all. The architecture argument built on it lives in `ROADMAP.md` §3.

## Sources, and what each one is worth

| Source | Read | Authority |
|---|---|---|
| `antigravity.google/docs/cli/*` — 26 pages, `headless`, `permissions`, `mcp`, `sandbox`, `settings`, `statusline`, `credits`, `conversations`, `features`, `reference` | 2026-09-02 | The vendor's own documentation. Highest available. Note its `reference` page still names **1.1.22** |
| `antigravity.google/docs/subagents#custom-subagents` | 2026-09-02 | The only published agent-frontmatter schema |
| `agy --help`, every subcommand's `--help` | 2026-09-02, **1.1.24** | Published by the binary in hand. Occasionally contradicts the docs site — both are recorded when they differ |
| `agy changelog` (562 lines, 1.1.24 down) | 2026-09-02 | Vendor-authored release facts |
| `github.com/google-antigravity/antigravity-cli` | 2026-09-02 | Official repo. README, `CHANGELOG.md`, `examples/`, **no `docs/`** — it links back to the docs site |
| Probes run for this file, `agy 1.1.24`, `gemini-3.7-flash-low` | 2026-09-02 | Establishes behaviour where the published sources are ambiguous or silent. Recorded as probe evidence, never as contract |

The installed vendor is **1.1.24**. Everything in `verification/README.md` above this entry is evidence against `1.1.22` or `1.1.23`.

## What the vendor actually publishes

Recorded because most of it was never written down here, and several dependencies previously carried as probe findings turn out to be contract.

**Headless transport** (`/docs/cli/headless/`). `--input-format stream-json` "maintains a persistent conversation across multiple turns within a single process", requires `--output-format stream-json`, and takes one JSON object per line on stdin whose documented shape is exactly:

```json
{ "event": "user", "message": { "content": "..." } }
```

Only `text` content blocks are supported in streamed messages. Each turn emits its own `result`. Events are `init`, `step_update` (`step_type` of `user_input`, `agent_response`, `tool`), and `result`. The result envelope carries `conversation_id`, `status`, `response`, `duration_seconds`, `num_turns`, `usage`, `structured_output`, `json_schema` and an optional `error`. `status` is one of `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING`. **`num_turns`, `usage` and `duration_seconds` accumulate across the session** — the adapter's usage subtraction is therefore contract-mandated, not a workaround. Closing stdin exits `0`. A tool needing approval is **soft-denied**: the run continues and exits `0` with a stderr notice. Slash commands do not work inside a streaming session.

**Permissions** (`/docs/cli/permissions/`). Rules live in `~/.gemini/antigravity-cli/settings.json` under `permissions.allow` / `deny` / `ask`, precedence **Deny > Ask > Allow**. Syntax by class: `read_file(path)`, `write_file(path)`, `read_url(host)`, `execute_url(host)`, `command(prefix|regex)`, `unsandboxed(prefix)`, `mcp(server/tool)`, `mcp(server/*)`. Workspace files are allowed by default for read/write; anything unconfigured defaults to Ask. The CLI's own headless denial message names this same file and key.

**MCP** (`/docs/cli/mcp/`). Global `~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json`. One `mcpServers` map; per server `command`/`args`/`env`/`cwd` or `serverUrl`/`headers`, plus `authProviderType`, `oauth`, `disabled` and **`disabledTools`** — a published per-server tool denylist.

**Agent definitions** (`/docs/subagents#custom-subagents`). Workspace agents at `.agents/agents/<name>.md` or `.agents/agents/<name>/agent.md`, global at `~/.gemini/config/agents/`. Published frontmatter keys: `name`, `description`, `tools` (string[], default `[]`, "explicit list of tools permitted"), `mainAgent` (bool, default true), `subagent` (bool, default true), `model` (`inherit`/`flash`/`pro`), `commandExecutionPolicy` (`off`/`auto`/`eager`/`sandbox`, default `sandbox`), `mcpServers`, `skills`, `plugins`. Tool names appearing anywhere in the docs: `view_file`, `replace_file_content`, `grep_search`, `run_command`, `invoke_subagent`, `call_mcp_tool` (only as permission syntax).

**Sandbox** (`/docs/cli/sandbox/`). `nsjail` on Linux, `sandbox-exec` on macOS, `AppContainer` on Windows; confines agent-executed terminal commands. Setting `enableTerminalSandbox`, default false.

**Status line** (`/docs/cli/statusline/`). A `statusLine` command in `settings.json` receives a state JSON on **stdin** carrying `session_id`, `conversation_id`, `transcript_path`, `model`, `context_window` (`total_input_tokens`, `total_output_tokens`, `context_window_size`, `used_percentage`, `current_usage` with a cache breakdown), **`quota`** (per model id: `remaining_fraction`, `reset_time`, `reset_in_seconds`), `plan_tier`, `email`, `execution_mode`, `sandbox`, `vcs`. This is the only published machine-readable quota channel in the product; `/docs/cli/credits/` documents no non-interactive way to read quota at all.

## Dependency inventory

`P` = published contract. `A` = published but ambiguous or contradicted between sources. `O` = observed only, vendor silent. `I` = not a CLI surface — a private interface of another vendor process.

| # | What we depend on | Where | Status |
|---|---|---|---|
| 1 | One process, one turn per NDJSON stdin line, persistent conversation | `agy-session.ts` | **P** |
| 2 | Input line `{event:'user',message:{content}}` | `antigravity-primary.ts:426,453`, `web-search-backend.ts:227` | **P** |
| 3 | `init` / `step_update` / `result` event names, `result` envelope fields | `agy-session.ts`, `agy-vendor.ts` | **P** |
| 4 | `usage` accumulating per conversation, hence subtraction | `AgySessionState.lastUsage` | **P** |
| 5 | `SUCCESS` as the success discriminant | `isSuccess()` | **P** |
| 6 | `--add-dir`, `--agent`, `--sandbox`, `--model`, `--effort`, `--print-timeout`, `--json-schema` | `antigravity-primary.ts:1371` | **P** |
| 7 | Soft-denial on an unapprovable tool, exit `0` + stderr | the `attached()` and blocked-tool checks | **P** |
| 8 | Workspace agent at `.agents/agents/<name>.md`; `tools`, `mainAgent`, `subagent`, `commandExecutionPolicy` | `bridgeAgentMarkdown()` | **P** |
| 9 | `agy mcp add/list`, global `mcp_config.json` | README setup, precondition check | **P** |
| 10 | **`--json-schema` binding every turn of a streaming session** | the whole `schema` transport | **A** — `--help` says "for stream-json, only applicable to the final result"; the docs say "the schema applies to the terminal `result` event". Probed below: real but best-effort, and it fails silently. **Do not treat as a guarantee** |
| 11 | Print mode entered with no `-p`/`--print` at all | `antigravity-primary.ts:1371` | **A** — `--input-format` is documented as belonging to print mode; nothing says it is sufficient alone. Works on 1.1.24 |
| 12 | Suffixed catalog ids (`-low`/`-medium`/`-high`) and `--effort` only alongside a base id | `resolveInvocationModel()` | **O** |
| 13 | `agy models` emitting `id<TAB>name`, same text inside the JSON envelope's `response` | catalog parser | **O** |
| 14 | `inheritCustomizations: false` | `bridgeAgentMarkdown()` | **O** — key is in no published schema |
| 15 | `finish` as a tool name in an allowlist | `bridgeAgentMarkdown()` | **O** — the name appears nowhere in the docs |
| 16 | `tools:` not gating MCP tools; `init.tools` reporting the whole registry regardless of the agent | `mcp-transport.ts`, the blocked-tool backstop | **O** — probe-established, and the docs decline to say either way |
| 17 | Naming `call_mcp_tool` in `tools:` terminating the agent | constant in `mcp-transport.ts` | **O** |
| 18 | A blocking MCP call holding the vendor turn open | the entire `mcp-bridge` transport | **O** — and already known to break intermittently at a yield boundary (`ROADMAP.md` §5) |
| 19 | `agy` handing its own env to an MCP server child | socket + one-shot token addressing | **O** |
| 20 | Prefix cache engaging above roughly 20k | the session-lived child's whole justification | **O** — no published cache behaviour of any kind, but re-measured under the production config on 1.1.24 and it holds; see finding 6 |
| 21 | Grants read from `~/.gemini/config/config.json` → `userSettings.globalPermissionGrants.allow` | `antigravity-primary.ts:80-83,1540,1590` | **O** — honoured by the binary, but so is the documented store, and only the documented one is what the CLI's own error text names. See finding 2 |
| 23 | Only a GLOBALLY registered MCP server has its tools declared to the model | the bridge's once-per-machine setup | **O** — probe 4 below; the published workspace scope loads and connects a server whose tools the model never sees |
| 24 | Permission grants must come from user-owned global config | the bridge's precondition check | **P**-adjacent — the docs name only the global file, and probe D confirms a workspace-scoped `permissions` block is ignored |
| 22 | `RetrieveUserQuotaSummary` over a loopback port with a CSRF token, endpoint found by scanning the process table | `usage-source.ts`, `quota-harvest-cache.ts` | **I** — a private RPC of the vendor's language server. No CLI surface exists for it |

## Findings from this pass

**1. `structured_output` goes STALE, and the shipped `schema` transport consumes it silently.** Probed twice on 1.1.24 in one streaming process with one `--json-schema`:

- three neutral turns (capitals of France/Japan/Peru) each produced a fresh, correct `structured_output`. Per-turn enforcement is real, which is what the tree recorded against 1.1.22;
- but a turn whose user instruction competed with the schema ("reply with exactly the word banana and nothing else") answered in **prose** — `response` was `"banana\n"` with no JSON in it — and the envelope's `structured_output` still held **the previous turn's object**, `{"kind":"message","text":"apple"}`, verbatim.

`structuredResult()` (`schema-transport.ts:277`) trusts `structured_output` first and has no freshness test, so that turn is read as a valid decision the model never made. Where the stale object is a `tool_calls`, DSH re-executes the identical call — a mechanically exact generator of repeated identical tool calls, and one that survives every fix made on 2026-08-31. This is the first mechanism of that class found in the transport itself rather than in the envelope, the ids or the model's discipline.

**Reproduced, and the remedy demonstrated end to end** (`agy 1.1.24`, `gemini-3.7-flash-low`, two runs, one process each):

| Run | Schema | Turn 1 | Turn 2 |
|---|---|---|---|
| S1 | `{kind,text}` | `response` carries the JSON; `structured_output = {"kind":"message","text":"The capital of France is Paris."}` | `response = "banana\n"`, no JSON anywhere in it; `structured_output` **identical to turn 1's**, verbatim |
| S2 | same plus a required `turn_nonce` | envelope declared `N7-AAA`, reply carried `turn_nonce:"N7-AAA"` | envelope declared `N7-BBB`, `response = "banana\n"`; the stale `structured_output` still carries **`N7-AAA`** |

So the remedy stays inside published surface and is measured, not designed: put a per-turn nonce in the forced schema, set it in the envelope, require it in the reply, and fail the turn when it does not match. S2 shows the stale reply is then distinguishable from a fresh one by construction. It also gives the ambiguity in row 10 a safe reading — treat per-turn enforcement as best-effort and detect its absence, rather than resting on it.

A second, cheaper check falls out of the same data and should be used alongside rather than instead: on both stale turns the turn's own `response` contained no JSON at all, so requiring the decision to appear in this turn's `response` catches the same failure without touching the schema.

**2. Two permission stores exist, the binary honours BOTH, and we read only the undocumented one.** The documented location is `~/.gemini/antigravity-cli/settings.json` → `permissions.allow`, and the CLI's own headless denial message names exactly that: *"Add an allow-rule under permissions.allow in settings.json"*. This package instead reads `~/.gemini/config/config.json` → `userSettings.globalPermissionGrants.allow`, and its fresh-install error text instructs the user to add `mcp(dshtools/*)` there. Both files exist here: `settings.json` held only `trustedWorkspaces`, while `config.json`'s `userSettings` held `globalPermissionGrants`, `enableTerminalSandbox`, `autoExecutionPolicy`, `nonWorkspaceFileAccessPolicy`, `artifactReviewMode` — semantically the documented settings under different names.

Probed on 1.1.24 with one grant, `command(echo)`, and a prompt that runs `echo MARKER-PW4412`, each arm a separate process, both stores restored byte-identical afterwards (sha256 verified):

| Arm | Grant in | Outcome |
|---|---|---|
| baseline | neither | `run_command` **ERROR**, `permission check failed ... user denied permission`, `jetski: no output produced` on stderr |
| 1 | `settings.json` → `permissions.allow` (documented) | **executed**, marker returned |
| 2 | `config.json` → `userSettings.globalPermissionGrants.allow` (ours) | **executed**, marker returned |

So this is not a broken dependency — it is a redundant one bound to the undocumented half. The fix is small and worth making anyway: read the documented store as well, and make the error text name the documented file the way the vendor's own message does, since that is the file a user following the vendor's documentation will edit.

**3. `disabledTools` is a published isolation lever we do not use.** A per-server tool denylist in the MCP config is contract, where the agent `tools:` allowlist is documented for subagents and probe-known **not** to gate MCP tools at all (row 16). Anywhere isolation currently rests on the allowlist, part of it can rest on a published key instead.

**4. Workspace-scoped MCP registration loads the server and hides its tools — so `mcp-bridge`'s two-step user-owned setup is unavoidable.** `.agents/mcp_config.json` is published as a supported scope, which would have removed `mcp-bridge`'s once-per-machine global registration, its largest deployment cost. Probed with a trivial stdio MCP server declared there, `--add-dir` on that directory, and the model asked for its tool:

- the vendor **did** load and connect it: it wrote a schema cache at `~/.gemini/antigravity-cli/mcp/probews/probe_marker.json` on every such run, which only a completed `tools/list` produces;
- the model was **not** given it. Asked to enumerate its own declarations with filesystem access forbidden — and with the cache directory deleted first, so it could not read the answer off disk — it named only `dshtools`, the globally registered server, and reported `probews` as unavailable;
- one earlier run *appeared* to succeed and did not: the model located the cached schema file with `view_file`, guessed the call, and `call_mcp_tool` dispatched it by name as far as the permission gate (`permission check failed for mcp "probews/probe_marker"`). Dispatch by name works for a configured server; declaration is what the model lacks. Reading that run as "injection works" would have been the wrong conclusion, and it is why the enumeration control was added;
- a control in the same workspace confirms `.agents/` itself is read: an agent defined at `.agents/agents/probeagent.md` resolved under `--agent` and its instruction token came back in the reply.

This **confirms** the record in `ROADMAP.md` §3 rather than superseding it — that probe used `.agents/plugins/<name>/mcp_config.json` and reached the same place by another door.

**Probe D, the follow-up worth having: the grant cannot move into the workspace either.** With both global stores restored to their originals, a `permissions.allow` block written to `.agents/settings.json` in the workspace was ignored — the same `command(echo)` that arms 1 and 2 executed came back `permission check failed`. That run doubles as the baseline for finding 2. So `mcp-bridge` requires two things from user-owned global configuration, `agy mcp add` and a grant, and neither can be shipped inside our own ephemeral workspace. That is now established rather than assumed.

**5. The only published machine-readable quota channel is the status-line payload.** It carries per-model `quota.remaining_fraction`, `reset_time`, `reset_in_seconds` plus the full context-window breakdown, delivered on stdin to a user-configured command — but it is a TUI feature and does not fire in a headless turn, so it cannot replace row 22 as it stands. What it does settle is that the vendor publishes no non-interactive quota API at all: the usage capability is not an undocumented shortcut past a documented path, it is a capability the CLI contract does not offer. That makes row 22 an explicitly accepted internal dependency rather than an oversight — and it is the one dependency in this file that a vendor rename breaks with no fallback.

**6. The prefix cache still engages on 1.1.24 under the production config — row 20 holds, and the earlier zeros were the threshold, not a regression.** The first probes reported `cache_read_tokens: 0` at 30k, 45k and 61k *cumulative* input, which looked like the 20418-of-23496 figure recorded on 1.1.22 had stopped reproducing. It had not: those runs used the **default** agent, whose own prefix is ~15k per turn — below the engagement threshold — and the tree's own Codex work established that an under-configured probe measures the probe.

Re-measured with the shipping shape — ephemeral workspace, `.agents/agents/dsh-primary.md` with `tools: [finish]` and `inheritCustomizations: false`, `--add-dir`, `--agent`, `--sandbox`, the real `bridge-output.schema.json` under `--json-schema`, one `full` envelope of 142k characters (system prompt, 44-tool catalog, 20 history messages) followed by two small `delta` envelopes in the same child:

| Turn | Envelope | Cumulative `input_tokens` | Own uncached input | Own `cache_read_tokens` |
|---|---|---|---|---|
| 1 | `full` | 30,596 | 30,596 | 0 |
| 2 | `delta` | 32,908 | **2,312** | **28,613** |
| 3 | `delta` | 35,548 | **2,640** | **28,596** |

93% of a ~30.6k prefix served from cache on every continuation, and a continuation costs ~2.4k of new input against the ~30.6k a fresh conversation pays — the same ratio the 1.1.22 figure recorded, on a larger prefix. The session-lived child's justification stands on the installed binary.

Two contract details fell out of it, both worth having written down:

- **`input_tokens` accumulates UNCACHED input, and `cache_read_tokens` accumulates separately.** Turn 2 re-sent the whole ~30k context yet the cumulative figure rose by only 2,312. So the adapter's subtraction yields that turn's own uncached input, which is the right thing to report — but nothing in the envelope is a per-turn total, and a reader who assumes `input_tokens` is "everything the model saw" will under-count by whatever the cache served;
- **`init.tools` reported 57 tools with `tools: [finish]` in force**, reconfirming row 16 on 1.1.24: that field is the vendor's registry, not the agent's allowlist, and must never be read as an isolation check.

## Probe hygiene

Every probe above ran on `agy 1.1.24` / `gemini-3.7-flash-low` from a scratch directory outside this repository. The cache probe of finding 6 mutated nothing at all — its workspace, agent definition and schema file were disposable copies. `agy mcp add` was never called, so the vendor's MCP registry still holds only `dshtools`. The two global config files were backed up first, mutated one arm at a time, and restored byte-identical — `sha256sum` verified against the backups after the last arm. The `~/.gemini/antigravity-cli/mcp/probews/` schema cache the vendor wrote during probe 4 was deleted afterwards. These probes are exploratory and are not retained as a suite; the recipes are in this file.

## Consequences

1. **LANDED.** Row 10 was the load-bearing ambiguity of the `schema` transport and finding 1 made it a live defect. Every envelope now carries a `turn` stamp the reply must echo, a decision stamped for another turn is refused as `ANTIGRAVITY_STALE_DECISION`, and a refused turn abandons the conversation instead of continuing it. Bridge protocol `v2` -> `v3`. Antigravity 133 -> 138 tests; `test:live:primary` 8/8, `test:live:session-continuation` 1/1, `test:live:mcp-bridge` 1/1 and `test:live:agent-allowlist` 1/1 against real `agy 1.1.24`, which is the first live evidence on that build.
2. **LANDED.** Row 21 was redundant rather than broken (finding 2). Both stores are now read, a grant in either counts, and the setup text and README name the documented one first.
3. Rows 16, 18, 19 and 23 are what `mcp-bridge` rests on, all observed-only, and row 18 has already broken in production. Findings 4 and D add that its setup cost is irreducible: two pieces of user-owned global configuration, neither shippable in our workspace. Rows 1-9 — everything the `schema` transport needs besides row 10 — are published, and it needs no setup at all. On contract exposure the `schema` transport is the lower-risk primary, which is the direction Codex's §7d stepped-turn decision took for the same reason.
4. The published event and envelope names (rows 1-5) deserve a test that asserts them against a recorded live sample, so a vendor rename fails a test instead of a session.
5. `verification/README.md` should stop implying the audited vendor is `1.1.22`. The installed binary is `1.1.24` and the live suites have not been re-run on it.
6. Row 20 is settled on 1.1.24 (finding 6): the cache engages under the shipping config, so the session-lived child stays. What is still open is narrower — the exact engagement threshold, which this probe brackets between ~15k (default agent, no credit) and ~30k (production shape, 93% credit) without locating.
