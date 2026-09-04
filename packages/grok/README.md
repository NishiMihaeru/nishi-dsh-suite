# nishi-dsh-grok

The Grok provider plugin for Nishi DSH Suite. It routes DSH turns through the user's own installed official Grok Build CLI (`grok`), which authenticates with that user's own account.

Provider id `grok`; model route `grok-cli`.

## What it declares, and what it does not

| Capability | State |
|---|---|
| Model route `grok-cli` | Present. One short-lived headless process per DSH step, continuing one vendor session. |
| Usage and limits | Present. Quota is ACP `_x.ai/billing` over `grok agent stdio`: after `initialize`, no session, no turn. `/usage` is still a TUI-only action and is not this channel. A reading with no finite percentage inside an open period is `UNAVAILABLE`, not a meter of zero. |
| Native web search | Absent for now. The vendor has a `web_search` tool, but this route denies web search as part of its isolation posture and a routed backend needs its own contract read first. |

## The transport

Per DSH step, one process:

```text
grok --prompt-file <envelope.json> --output-format json --json-schema <decision schema>
     --model <id> [--reasoning-effort <effort>] --system-prompt-override <transport rules>
     --max-turns 4 --tools read_file --disallowed-tools read_file,Agent --deny MCPTool
     --disable-web-search --no-subagents --no-plan --no-auto-update
     (--session-id <uuid> | --resume <uuid>)
```

Five measured facts shape that line, all recorded in `docs/verification/grok-cli-contract.md`:

**`--resume` keeps the prefix cache across processes.** A second turn in a new process reported 140 uncached input tokens against 4,480 read from cache. The sibling Antigravity route holds a live vendor child per DSH session precisely because a fresh `agy` process cannot do this; here there is no live child, no delta-versus-full negotiation with a process, and no idle reaper.

**Usage is per invocation.** `agy` reports a conversation's running total, so that route must subtract the previous turn's figures out. This vendor reports the step's own spend, in DSH's own disjoint buckets — uncached input, cache read, cache creation, output, reasoning.

**`--tools ""` is a silent no-op.** An empty allowlist leaves the model holding the full 25-tool set, including shell and file write. Naming one real tool in the allowlist *and* the same tool in the denylist is what reaches an empty toolset; only the vendor's two MCP meta-tools survive, and `--deny MCPTool` gates those. `test/argv.test.ts` pins this, because the safe-looking spelling fails open.

**The envelope is the message, not an attachment to it.** It travels as `--prompt-file` containing an ACP `{type:"acp",content:[{type:"text",text:<envelope>}]}` object. `--prompt-json` is an argv slot, and Linux kills a single argument at 128 KiB (`E2BIG`); a DSH full envelope crosses that on an ordinary session. `--prompt-json @file` is not a file form (measured: invalid JSON). A `.json` `--prompt-file` is parsed as ACP and rejects any other object. An embedded ACP `resource` was tried first: it is readable in isolation, and it fails in front of an agent. Handed DSH's 29-tool catalog, the model treated a `dsh://` resource as something to open and spent its round calling DSH's own `read` on it. DSH's own system instruction rides in the envelope: there is no `--system-prompt-file`, so putting it on `--system-prompt-override` would just move the `E2BIG` to a different slot.

**The vendor's own agent loop gets a few rounds, not one.** `--max-turns 1` looks like the exact stepped shape and is a trap: the vendor spends a round on its structured-output retry whenever the model first answers outside the schema, and the cap turns that ordinary hiccup into a dead step reported as `stopReason: "cancelled"` — which reaches the user as "the turn was cancelled" and names nothing fixable. The cap is `vendorTurnCap`, defaulting to 4, and an exhausted cap is classified from the vendor's own `Error: max turns reached` rather than from the overloaded stop reason.

## Session continuation

DSH's history is authoritative and is rewritten behind the adapter's back: compaction shadows nodes, the tool-result pruner truncates, the user rewinds. A vendor session may be continued only by a request whose messages start with exactly the digests already delivered, in order, and whose model, effort, system prompt and tool catalog still match the ones the session was opened with. Anything else opens a new session from DSH's own copy — a rebuild is correct, not an error.

The session UUID is minted by this package rather than issued by the vendor, so replay state needs no vendor-issued id. An auxiliary call (compaction, session title) never touches the session's conversation: it brings its own history and gets a throwaway session and a schema that cannot express a tool call.

## The model catalog is free

The ACP `initialize` handshake (`grok agent stdio`) publishes every routable model with its real `totalContextTokens` and its reasoning-effort list, and reading it runs no turn, opens no session and spends no tokens. That is better instrumented than either sibling route: Antigravity has to configure a context window because `agy models` discloses none. The shape is undocumented, so `test/model-catalog.test.ts` pins a recorded handshake — a vendor rename must fail a test rather than leave a route silently uncompacting.

## Usage & Limits is the same handshake plus one method

`/usage` is documented as a TUI billing action and is not a headless channel: `grok -p "/usage"` reaches the model as prose. After the same turn-free `initialize`, `_x.ai/billing` returns `config.creditUsagePercent` and an open `currentPeriod`. That method is a vendor extension, so `test/usage-billing.test.ts` pins a recorded result the way the catalog test pins the handshake. Prepaid and on-demand fields have been seen only as `{val: 0}` with no unit and are not projected. The collector never reads `auth.json` and never talks to an xAI endpoint itself — Grok owns the call.

## Isolation and permissions

DSH owns tools, permissions, durable history, workspace access, memory and execution. The vendor executes nothing on this route, which is why it never passes `--always-approve` or any permission-mode override: a transport that needed vendor auto-approval would be one managed policy away from not running, and a machine pinning `disable_bypass_permissions_mode = true` refuses that flag outright.

Every child runs in a throwaway working directory rather than the user's repository, because the vendor discovers a project root by walking up for `.git` and then scopes `AGENTS.md`, skills and git history to it.

## Vendor boundary

Nothing here bundles or redistributes the `grok` binary, and nothing reads its credential store. Authentication stays inside the vendor's product; the user signs in with `grok login` themselves. See `THIRD_PARTY_NOTICES.md`, and `docs/verification/grok-cli-contract.md` for the contract inventory and the xAI terms read behind these choices — including the two conditions that bind this package rather than its design.

## Status

Pre-acceptance. Focused tests cover the primary route and the ACP billing usage source. `pnpm test:live:primary` passes 4/4 against real `grok 1.0.13`; `pnpm test:live:usage` is the turn-free billing probe. The route has served a real DSH request in the `web` profile -- the first one failed, and findings 16 and 17 of the contract file are what it cost. No product-level profile acceptance run has been recorded yet.
