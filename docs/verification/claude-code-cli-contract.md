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

Nothing here is probe-established. No probe has been run against `claude` for a primary route, and the classifications below say so.

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
| 2 | `--input-format stream-json` + `--output-format stream-json` | one long-lived child per DSH session | **P** for existence, **O** for the property that matters: whether one child runs several turns from successive stdin lines, as `agy` does |
| 3 | `--json-schema` | the forced-decision transport, identical in shape to Antigravity's | **P** with `--output-format json`, **A** with `stream-json`. The same ambiguity row 10 of the `agy` contract records, and it must be probed before it is relied on |
| 4 | `structured_output` as the field carrying the schema-bound value | reading the decision | **P** — and the same field name `agy` uses, so the existing transport shape transfers |
| 5 | `--tools ""` disabling every built-in tool | the isolation posture; the published equivalent of Antigravity's `tools: [finish]`, with no agent file needed | **P** |
| 6 | `--system-prompt` fully replacing the default prompt | owning the prefix | **P** |
| 7 | `--session-id <uuid>` | **client-minted session identity** — neither Codex nor `agy` offers this; replay state needs no vendor-issued id | **P** |
| 8 | `--no-session-persistence` (print mode) | removing the durable-residue property Codex has and cannot clean up | **P** for existence, **O** for compatibility with continuity: no persistence means no `--resume`, so continuity must come from the live process instead |
| 9 | `--mcp-config` + `--strict-mcp-config` | declaring DSH tools per invocation | **P** — and the reason the "irreducible setup" argument that removed Antigravity's `mcp-bridge` does **not** transfer: nothing needs to be written to user-owned global config |
| 10 | `system/init.capabilities` (array of behaviour names, e.g. `interrupt_receipt_v1`) | feature detection instead of version comparison | **P**, v2.1.205+. A strictly better instrument than Codex's version floor, aimed at the same problem |
| 11 | `system/init.mcp_server_errors` / `plugin_errors` | failing loudly when a declared server never loaded | **P**, v2.1.219+ |
| 12 | `system/api_retry.error` typed categories (`authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown`) | precise diagnostics as a **field**, not stderr prose | **P**. This is why a Claude recogniser list can map a published enum instead of guessing at vendor wording the way Antigravity's two-entry list has to |
| 13 | `--replay-user-messages` | per-message acknowledgement that a delivered message was received | **P**, `stream-json` both ways. The nearest thing any of our three vendors offers to "what do you believe the history is" |
| 14 | `--effort low\|medium\|high\|xhigh\|max`, `--model <alias\|full>` | mapping DSH reasoning effort and model | **P** |
| 15 | `--safe-mode` | isolation **with authentication intact** — "all customizations … disabled … Auth, model selection, built-in tools, and permissions work normally" | **P** for the wording, **O** for whether an explicit `--mcp-config` still loads under it |
| 16 | `--max-budget-usd`, and `total_cost_usd` in the `json` envelope | a per-invocation spend bound; client-side estimates by the vendor's own admission | **P** |
| 17 | SIGINT ends the turn; SIGTERM leaves it unfinished with exit 143 and no recorded result, and a later resume continues that unfinished turn | dispose ordering | **P** — documented on the headless page, and it inverts the naive choice: dispose must send SIGINT first |
| 18 | `--bare` | — | **X** — condition 2 above |
| 19 | `--fallback-model` | — | **X** — automatic model substitution mid-work is the defect class the mid-turn route switch already cost this repository |
| 20 | `--dangerously-skip-permissions` | — | **X** — the posture every TUI-scraping orchestrator is forced into, and the opposite of this suite's |

## Traps

1. **`-p` executes repository content without a trust prompt.** The vendor's own page: without `--bare`, a `-p` session "runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted", with no workspace-trust dialog and no per-server approval, and settings files that fail validation are silently ignored. A primary route invokes this in the user's own workspace, so the exposure is real and it is ours to close. `--bare` cannot be the answer (condition 2). The candidate answer is `--safe-mode` plus `--strict-mcp-config` and an explicit `--settings`/`--setting-sources`, which needs row 15's probe.
2. **Unfinished turns survive.** See row 17. Killing a child with SIGTERM leaves a turn that a resumed session will continue — a vendor-side analogue of the parked-turn class this repository has now fixed twice.
3. **Background work extends process lifetime.** Background Bash tasks are killed about five seconds after the final result, but background subagents and workflows are waited for, capped at ten minutes of continuous idle by default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). Any grace timeout must account for that, and the isolation posture should make such tasks unreachable in the first place.

## Open probes, in the order they should run

Every one of these spends the maintainer's real quota except where noted. Ask first.

1. **Does one `--input-format stream-json` child run several turns?** Row 2. The whole session-lived-child and prefix-cache design rests on it, exactly as it did for `agy`, and it must be answered before code is written rather than after. Partially free: whether the process stays open after the first `result` costs nothing to observe.
2. **Does `--json-schema` bind each turn of a streaming session, or only the final result?** Row 3. The `agy` precedent is the reason to distrust the help text in either direction.
3. **Does `--mcp-config` load under `--safe-mode`?** Row 15. Decides whether isolation and an MCP tool path can coexist.
4. **Prefix-cache measurement under the production shape**, with arm order counterbalanced. Both other providers taught the same lesson: an under-configured probe measures the probe.
5. **`--no-session-persistence` with a long-lived child** — does continuity hold with nothing on disk? Row 8. If yes, this route gets continuity *and* leaves no residue, which neither other provider manages.

## Consequences

1. **Architecture decision, not yet implemented: the thin route, not the agentic one.** Constrain the reply with `--json-schema`, disable the vendor's own tools, and keep the loop in DSH — one completed vendor turn per DSH step, the same conclusion `ROADMAP.md` §7d reached for Codex. The agentic alternative (Claude Code runs its loop, DSH tools arrive over MCP) makes one vendor turn span many DSH steps, which is the class §5 exists for, and it puts a second compactor on history DSH considers authoritative. MCP stays in reserve rather than rejected: unlike `agy`, it costs no user-owned setup here (row 9), so an agentic mode remains cheap to add later.
2. **The terms are settled and the tree is not compliant yet.** Conditions 1-4 are satisfiable by construction, but the package name and the glyph are not, and both are cheaper to change before publication than after.
3. **Nothing here is evidence.** No probe has run. Rows marked **O** and every item in *Open probes* are the honest boundary of this document, and a live suite will be needed before any of it is called validated.
