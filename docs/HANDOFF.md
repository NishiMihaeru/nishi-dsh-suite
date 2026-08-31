# Handoff

Rewritten for a fresh session at HEAD `28883af`, kept current through the working-discipline and MCP-route documentation pass (`f2b273b`). It describes the tree as it is now, not the audit narrative it grew out of — that history lives in git and in `docs/verification/README.md`.

This is the only session handoff file. Update it in place when the active task changes; do not create dated handoff/plan/session-summary files.

## Current branch/state

```text
feat/core-provider-plugins-rc3
```

Six packages at `0.1.0-rc.3`, unpublished. Working tree clean, branch pushed and in sync with origin at `fc90dc0`. Pushing this branch is all that has ever happened here: nothing is merged, tagged, released or published.

Only supported DSH generation:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

`0.1.1-rc.2` and earlier are **not supported**. Every declared peer, the dev graph and the whole test suite say exactly that. `docs/README.md` owns the policy and the *Local setup* note explaining why `pnpm install` needs the local upstream checkout.

Windows: **NOT TESTED**. No publish, merge, tag or release is authorized.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests
7. `docs/verification/README.md` when exact accepted evidence matters

`docs/verification/gemini/LATEST.md` is the rolling raw report, not the durable ledger.

## Where the packages stand

All four thawed packages are **THAWED, PENDING INDEPENDENT VALIDATION**. Nothing here is frozen, and the only thing standing between this tree and a freeze claim is a validator who did not write the code.

| Package | State |
|---|---|
| Core | remediated; Model Accounts surface removed outright; sidebar provider selection and ordering added; 200 tests |
| Project Memory | recovery read race fixed with deterministic coverage; 77 tests |
| Codex | provider audit done, thread handling redesigned, live acceptance re-run at 78 tests; mid-turn route-switch defect fixed and covered live; 81 tests |
| Antigravity | provider stage reopened deliberately: the MCP tool bridge is adopted and its transport-independent half has landed behind `transport`, which still defaults to the shipped `schema` path; one live `agy` child per session replaces one process per step; the MCP tool bridge is the default transport after passing live acceptance; 118 tests |
| Claude | usage-only stub, unchanged; 6 tests |
| Suite | Orchestrator preset now allows cross-route subagents; 16 tests |

## Evidence on this tree

- `pnpm verify:local` exits `0` on three consecutive runs;
- Codex live, re-run in full on 2026-08-31 against this tree: primary, the full 15-scenario acceptance suite, `test:live:web-search` and `test:live:web-search-routed` all pass. This run covers the issue #4 projection fix, which the previous one (taken at Codex 72 tests) did not. The two web-search suites need `DSH_LIVE_CODEX_SEARCH_MODEL` set — `gpt-5.6-sol` was used — and fail a **precondition assertion** without it: a harness prerequisite, not a product defect. Do not read that exit code as a regression;
- Antigravity live, re-run **after** the session-lived conversation and the per-tool output schema landed: primary 8/8 and `test:live:session-continuation` 1/1 against real `agy 1.1.22`. The continuation suite asserts what a surviving turn cannot — that one child served both DSH steps, and that the model's answer carries a value it could only have read from the tool result. Native and routed search were last run on 2026-08-31 and were deliberately not repeated: neither change touches the search backend;
- cross-route delegation, exercised end to end in the real `web` profile for the first time: parent Codex -> child Antigravity, parent Antigravity -> child Codex, and one parent turn with two concurrent background Codex children. All pass, evidenced by each child session's own `request/header` route in the durable log rather than by the model's report. Up to six concurrent `codex app-server` processes were observed, with no residue afterwards. The same run found the mid-turn route-switch defect, which is now fixed (`ROADMAP.md` §2) and covered by `test:live:tool-result-continuation` — a live probe that asserts the model actually saw the tool result, not merely that the turn survived;
- an adversarial code review and a documentation audit were run over the whole change set. Both found real defects; all are fixed.

A green gate plus live suites is **not** an acceptance. See *What remains*.

## What was done

Ordered by how much it changes the contract.

- **DSH baseline moved to alpha.1 everywhere** (`2ae63bc`). Every peer range, the dev graph, `DSH_COMPATIBILITY_VERSION` and the contract-verifying scripts. Removed with it: the rc2/alpha `Function.length` arity probe and Core's two retired rc.2 dev fixtures. Two real incompatibilities surfaced and were fixed — `CallId` renamed to `ToolCallId` in `dsh-llm`, and `Context.slots` moving from `dsh-client-ui-slots` to `dsh-client-ui-renderer/client`.
- **Model Accounts removed from Core** (`a8b44fa`), together with the provider-declared `account` capability and its declarations in Codex and Claude. Removed rather than disabled. No Core path reads or mutates a vendor credential record any more.
- **Codex thread handling redesigned** (`79fa972`). An ordinary turn resumes instead of forking; rollback realigns on divergence; fork is kept only for a checkpoint that is neither the tip nor an ancestor. Motivated by measurement, not taste — see *Codex vendor threads* in `ARCHITECTURE.md`.
- **Project Memory recovery read race fixed** (`e38ce06`). A benign concurrent journal rewrite failed an unrelated caller's memory operation. Found only because `pnpm verify:local` was run repeatedly; a single pass stayed green throughout.
- **Vendor-authored text no longer reaches the model or the user** anywhere in the suite. Antigravity gained `antigravityVendorFailure`; Codex's remaining two sites were closed, one of them only after a review caught that a commit had already declared the work finished.
- **Antigravity provider stage**: audit, 7 → 73 tests, catalog parsing rewritten against the format the vendor really emits, vendor sandbox flag added, intra-package duplication removed, usage harvested from the provider's own turn process.
- **Antigravity reasoning efforts separated from model ids** (`5d74408`, with a follow-up). The vendor ships `gemini-3.7-flash-low/-medium/-high` as three models; the adapter now advertises one model with three efforts and maps the invocation back, keeping the suffixed ids as aliases. The follow-up made that mapping resolve through discovery instead of peeking at the model cache, which could otherwise send a suffixed id and a contradicting `--effort` once the cache had expired, and kept a catalog outage from losing an otherwise valid turn. A base id without an explicit effort defaults to `high` by deliberate choice. See *Antigravity model catalog and reasoning efforts* in `ARCHITECTURE.md`.
- **Codex no longer fails a turn over a context block it cannot carry** (issue #4). A stopped subagent's settlement notice quotes the interrupted child's terminal output, `tool-call` blocks included, into a `user` message. The plugin rejected those blocks, which killed the live turn and — with no checkpoint written — every later replay of that session. They are now projected to text on the transient request; durable history is untouched. Covered by focused tests only: it landed after the Codex live acceptance run above.
- **A subagent may now run on another primary route.** The Orchestrator preset mounts `subagent` with `modelSelectionSettings: true`, which is all the Suite owns here: a spawned child is an ordinary DSH agent reaching its model through `ctx.llm`, so every registered route — `codex-app-server` and `antigravity-cli` included — was already usable as a subagent model and nothing provider-specific was needed to make it so. The host settings singleton stays the surrounding profile's (the web-app bundle mounts it), and the allowlist stays a user authorization that is off by default. `subagent_fork` keeps selection off so the inherited prefix stays KV-Cache-eligible. Suite 12 -> 16 tests. See *Subagent model routes* in `ARCHITECTURE.md` and `ROADMAP.md` §7c.
- **Antigravity now holds one live `agy` child per DSH session instead of spawning one per step.** Every step used to be a whole process — primary, subagent and routed search alike — so every step opened a fresh vendor conversation, guaranteed a prefix-cache miss, paid a cold CLI start in the critical path, and handed the model its own past actions as JSON quoted back at it rather than as its own turns. `agy --input-format stream-json` already ran one turn per NDJSON line, and `--json-schema` turned out to be enforced per turn rather than only on the last, which was probed against the real binary before any code was written. Measured on `agy 1.1.22`, a continuation inside one child read 20418 of a 23496-token prefix from cache and paid ~3.3k new tokens instead of ~23.5k. Reuse is gated on the request extending exactly the message ids already delivered; anything else rebuilds. Two defects were found and fixed while doing it: the vendor's cumulative per-conversation usage would have been summed again by the token meter, and model-authored tool-call ids repeat across steps. See *Antigravity session-lived vendor conversation* in `ARCHITECTURE.md`.
- **Antigravity's forced output schema now types tool arguments.** It declared `arguments: {"type":"object"}` for every call, which an empty object satisfies — so a call with none of the tool's required fields was well-formed to the vendor, failed in DSH, and was retried by a model with no way to see why. Each variant now pins one tool name and that tool's own parameter schema. The shape (`anyOf` plus an `enum`-of-one discriminator) was probed against the real binary before it was written, and DSH schemas are rewritten into the vendor's subset first, with an unrepresentable schema abandoning that one tool rather than the whole catalog.
- **Three defects found by reading real session logs.** Worth naming because none of them failed a test, and two were silent by construction. `maxTokens` was refused on every request, so the new context capacity made compaction run and fail 35 times in one session while `agent/pre-step` logged a warning and carried on; it is now accepted and ignored for auxiliary calls only. The divergence check compared message ids, but the tool-result pruner rewrites a message's content and keeps its id, so 80k tokens of pruning never reached the vendor; it now digests content. And a delta echoed the conversation's own replies back at it, which doubled the density of every action in the transcript and helped a real session end in 43 identical `todo_write` calls after the work was done.
- **Antigravity advertises a context capacity.** Without one, `compaction-basic` refuses automatic pressure compaction and the refusal is swallowed as a single warning, so the route never compacted and had no bound on history growth at all. Codex still discloses none either; it is left alone deliberately because guessing a per-model window is not an adapter's decision (`ROADMAP.md` §3).
- **The Usage sidebar can be told which providers to show, and in what order.** Authored by Gemini 3.7 Flash driving this workspace through DSH, then reviewed and verified before landing. Resolution stays dynamic — ordered ids that are still registered first, newly registered ones appended and visible, saved ids no provider claims ignored — and no provider id is hardcoded. With no saved setting the rendering is exactly what it was. The preference is per browser, through a storage seam with a `localStorage` default; that is a deliberate choice for a display preference and not a DSH setting, worth revisiting if it ever needs to follow a user across machines. One defect was found in review and fixed on top: reordering while a provider was unregistered used to discard that provider's remembered slot. Core 182 -> 199 tests.
- **Web search left as it is, deliberately.** The investigation found the suite already routes search through the session's live primary model — the concern that prompted it was unfounded. What did change: search results now carry an untrusted-content notice (`81ca500`), which they previously did not.

- **The Antigravity MCP tool bridge is adopted, and half of it is built** (`a42dcc4`). Antigravity was the outlier: Codex stopped being a dumb model endpoint at its thread redesign, declaring the DSH catalog to the vendor and parking the vendor's tool request while DSH's own loop executes it, while Antigravity still strips `agy` to `tools: [finish]` and forces its reply through `--json-schema` — the last remaining generator of the repeated-tool-call pathology, since combining tools with a strict response schema is a documented cause. `agy` has no App Server equivalent, so MCP is the same design through the only door it offers. Four probes against real `agy 1.1.22` settled the shape: a call blocked 9.2s keeps the turn open and its result reaches the model inside it; a stdin line written during a blocked turn is buffered rather than interleaved, so the bridge and the session-lived child do not conflict; the vendor prefix still caches with an MCP catalog present (~57.2k of a 62k prefix read from cache per step, ~5.4–5.9k new); and there is exactly one server process per `agy` process whose `ppid` is the pid the adapter spawned. That last fact is both the correlation key and the isolation boundary — a server no live adapter claims is served an empty catalog, which is what bounds the global-registration exposure the maintainer accepted. Landed: the host, the server process, their protocol, and a `transport` flag defaulting to the shipped `schema` path, so rollback is one config key rather than a revert. The adapter wiring landed on top: the transport now runs end to end, racing an open vendor turn against a bridge call, answering a blocked call from DSH's history without writing a new vendor turn, and refusing to start at all when `agy mcp list` does not show the bridge server -- an unregistered bridge would otherwise hand the model no tools and read as a disobedient model. **Live acceptance passes** against real `agy 1.1.22` (`pnpm test:live:mcp-bridge`): the model calls a DSH tool natively, DSH's loop executes it, the result reaches the model inside the same vendor turn, and one child and one turn serve the whole loop. `--sandbox` turned out fine and stays. Two assumptions were wrong and cost the first two live runs: naming `call_mcp_tool` in the agent allowlist terminates the agent, and MCP tools are not gated by that allowlist at all -- so the bridge's agent now carries exactly the schema transport's `finish`-only list. One defect fixed: the `BLOCKED_NATIVE_TOOLS` backstop rejected the finished turn for using `call_mcp_tool`, now exempted and covered deterministically. **`mcp-bridge` is now the default** (maintainer decision, 2026-08-31). That is a breaking change for deployment, not for code: a fresh install does nothing until `agy mcp add` has registered the bridge server and `mcp(dshtools/*)` is granted, and the first turn says so with the resolved path. No silent fallback, by design. Antigravity 99 -> 118 tests. A second live suite settled the isolation question the bridge work raised: `test:live:agent-allowlist` observes that a `finish`-only agent invoked no native tool, leaked nothing from a file inside its own granted workspace, and still completed its turn -- so the allowlist prevents, and `init.tools` listing all 57 tools is the CLI's registry rather than the agent's effective set. That half of the isolation claim had never been observed before, on either transport. See *Antigravity MCP tool bridge* in `ARCHITECTURE.md` and `ROADMAP.md` §3.

## What remains

1. **Independent validation, then freeze.** This is the only blocker for all four packages. Everything below is optional next to it. The reason to insist: two reviews that were deliberately not told the author's reasoning each found defects the author's own green test runs had missed.
2. ~~**`thread/inject_items` is unverified.**~~ **Closed 2026-08-31**: it reaches the model, verified by `pnpm test:live:inject-items`. The probe puts a value where injection is the only path to it -- a tool result is not user-authored, so it lands in the injected half while a trailing user question is the whole turn input -- and asserts that split by sniffing the JSON-RPC before reading the answer, which was exactly the injected value.
3. **alpha.1 runtime probe as separate evidence.** It has effectively dissolved into the ordinary test run now that the whole workspace builds and tests against alpha.1, but it has not been repeated as a distinct artifact.
4. **Suite preset bridge may be obsolete.** It exists to work around an rc.2 launcher bug that overwrites third-party preset roots. Nobody has checked whether alpha.1 still has that bug. If it does not, remove the bridge rather than carry it.
5. **The tool-result continuation duplication is now removable.** It sends tool results twice -- injected, and again as turn input -- for one reason only: that item 2 was unverified. Item 2 is closed, so one of the two paths can go, at the cost of one repetition per continued turn. It is a behavioural change to a path that was fixed against the live vendor, so it needs `test:live:tool-result-continuation` re-run rather than a reading of the code.
6. **Accepted debts**, recorded with reasoning and revisit conditions in `ROADMAP.md` §3: no vendor version verification for Antigravity, and the `usage-source.ts` loopback TLS trust model.
7. **Blocked on upstream**: publishing `0.1.2-alpha.1` to npm. Until then the declared ranges are uninstallable from the registry, which gates publication rather than development, and the local-checkout overrides stay.

Decided and closed, so nobody reopens them: old vendor threads already in the user's Codex account are not being cleaned up; web search keeps routing through the session's primary model.

## Working notes that cost real time to learn

- `DSH.md` reaches every request on every route: `nishi-dsh-project-memory` reads it and renders it as `## Project Contract (DSH.md)`, and the runtime keeps that block visible across compaction. It is therefore the cheapest place to put behaviour that must always be in front of the model, and it needs no preset change. Its *Working Discipline* section was added after two real sessions failed in ways nothing in the tree corrected: one repeated `todo_write` 43 times after the work was finished, another wrote a task list once and never touched it again across 157 steps.
- `@deepseek-ai/dsh-agent-instructions` is mounted in the Orchestrator preset with `instructionFileCandidates: []` and `localInstructionFileCandidates: []`, so `AGENTS.md` / `CLAUDE.md` discovery is switched off. Upstream defaults are `['AGENTS.md', 'CLAUDE.md']`. Deliberate or not, it means the mechanism every vendor guide recommends for steering an agent is unavailable here, and `DSH.md` is the only always-on instruction surface. Note also that `~/.dsh/AGENTS.md` would be read by BOTH plugins if it existed, and project-memory reads it into its byte budget without ever rendering it.

- Node 24 is not on `PATH`; it lives in fnm. Prefix commands with `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`.
- Read exit codes from `$?` directly. A background wrapper's exit code is not the command's, and a pipeline hides the failure — this cost a false "green" once already this cycle.
- Live suites spend the maintainer's real vendor quota. Ask before running them in bulk.
- The live suites drive the adapter directly against a fake context; nothing in them exercises DSH's agent loop, delegation or presets. Anything about subagents has to be run in the real app. The recipe: `node packages/suite/lib/bin.js preset update` to push the packaged preset into `$DSH_HOME/.agent-presets`, add a `subagent-model-selection` section to `~/.dsh/settings.yaml` (`enabled: true` plus exact `allowedModels` routes), then `dsh web --no-open --port <port>` and drive the UI. Read the result from `~/.dsh/sessions/<workspace>/<session>/session.jsonl.zstd` (`zstd -dc`), not from the model's answer: the child session records `origin: subagent` and its own `request/header` route.
- Selecting a model in the web composer rewrites `agent-default-model` in `~/.dsh/settings.yaml`, and the selection lands on the request after the one already in flight. Switching model and sending in the same moment produced a mid-turn route change — which is how the open Codex defect in *What remains* was found, but it is also a trap when you meant to test something else.
- Core's `tsdown` build is not reproducible: two builds of an unchanged tree differ in CSS-module key order, so byte-level artifact comparison proves nothing.
- Reading source is not enough for vendor behaviour. Three conclusions drawn from code alone were wrong this cycle and only a live run corrected them.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Do not reintroduce destructive legacy credential deletion, or any Core credential-mutation surface, without a reviewed atomic-safe credential contract.
- Read command exit codes directly; avoid pipelines that mask failures.
- Windows remains **NOT TESTED**.
