# Verification ledger

This file is the compact durable validation record. It owns **what was accepted**, not the active task plan.

Raw local Gemini output lives only in:

```text
docs/verification/gemini/LATEST.md
```

`LATEST.md` is overwritten on every validation run. After a PASS, durable facts are folded here. Superseded raw detail remains available through git history.

DSH generations named in this ledger are historical run facts, not support claims. The only supported DSH generation is `0.1.2-alpha.1`; `0.1.1-rc.2` and earlier are unsupported. Evidence recorded against an rc.2 baseline documents what was actually executed at that checkpoint and never establishes rc.2 as a supported target. `docs/README.md` owns the policy.

## Current validation status — SUPERSEDED, RE-VALIDATION REQUIRED

Everything recorded in this section describes the implementation checkpoint named below. A later audit of Core, Project Memory and Codex reproduced defects in all three and changed behavior in each, so **this ledger no longer describes the working tree** and must not be promoted to it.

**Evidence for the `mcp-bridge` transport is history, not coverage (2026-09-03).** That transport was removed; `docs/ROADMAP.md` section 3 carries the decision. Every mcp-bridge line below describes code that no longer ships, including `test:live:mcp-bridge`, whose suite was deleted with it. It is retained because the vendor facts those runs established are still true of `agy` and are cited elsewhere -- that the allowlist does not gate MCP tools, that `init.tools` reports the vendor's whole registry, and that a blocking MCP call holds a turn open until it does not.

The current tree is the subagent-model-route change (`b023d21`) and the documentation commits on top of it, pushed. It passes a local gate: `pnpm verify:local` exits `0` on three consecutive runs. Current focused test counts are Core `182`, Project Memory `77`, Claude `6`, Antigravity `73`, Codex `81`, Suite `16`. (Reaching a green gate at all first took one fix — the first re-validation returned FAIL, PASS, PASS on a load-sensitive Project Memory recovery read race, itemized in `HANDOFF.md`; the `209`/`61`/`7`/`7` counts recorded at that point are themselves superseded by the Model Accounts removal, the Codex thread-resume redesign and the Antigravity catalog/diagnostic/usage rework since.)

Live suites were re-run in full on 2026-08-31 against this tree, so the earlier caveat that live evidence predated the issue #4 context-block projection fix no longer applies — that fix is now covered by a live acceptance run, not only by focused tests. All PASS, each read from its own exit code:

- Codex (`codex-cli 0.150.0`): `test:live:primary`, the full 15-scenario `test:live:acceptance`, `test:live:web-search` and `test:live:web-search-routed`. The two web-search suites require `DSH_LIVE_CODEX_SEARCH_MODEL`; they were run with `gpt-5.6-sol`, and without the variable they fail a precondition assertion rather than exposing a product defect;
- Antigravity (`agy 1.1.22`): `test:live:primary` (8 scenarios), `test:live:web-search`, `test:live:web-search-routed`.

Added 2026-09-02, after the parked-call turn-liveness guard landed: `pnpm test:live:primary` PASS (`8/8`) and `pnpm test:live:mcp-bridge` PASS (`1/1`), each exit `0` and read from its own exit code. It was run against **`agy 1.1.23`**, not the `1.1.22` every line above records — the machine's vendor had upgraded itself in the meantime, and nothing in the tree noticed or needed to. That is worth recording twice over: it is fresh live evidence for the bridge transport on an unaudited vendor build, and it is the concrete case the version-gate debt in `ROADMAP.md` §3 was closed against — an upper bound pinned to the audited `1.1.22` would have refused this run outright, while the run itself passed. The vendor behaviours the bridge rests on therefore held across at least one minor upgrade, observed rather than assumed. The two web-search suites were NOT re-run on `1.1.23`; their evidence above is still `1.1.22`.

Added 2026-09-03, after the `agy` contract audit and the two fixes it found (the per-turn stamp and the grant stores): `pnpm test:live:primary` PASS (`8/8`), `pnpm test:live:session-continuation` PASS (`1/1`), `pnpm test:live:mcp-bridge` PASS (`1/1`) and `pnpm test:live:agent-allowlist` PASS (`1/1`), each read from its own exit code, plus `pnpm verify:local` exit `0`. Run against **`agy 1.1.24`** -- the machine's vendor had upgraded itself again, and this is the first live evidence on that build. The continuation suite is the load-bearing one: the stamp is a new wire requirement on the model rather than internal bookkeeping, and that suite is the only unit of live evidence with two turns in one child, so a model ignoring the stamp would have failed there. The web-search suites were NOT re-run; their evidence remains `1.1.22`.

Exploratory probes for the contract audit, `agy 1.1.24` / `gemini-3.7-flash-low`, not retained as a suite; recipes and results in `docs/verification/agy-cli-contract.md`. Four things established: `structured_output` is not cleared between turns and a turn producing none of its own resolves with the previous turn's object (reproduced twice, and the nonce remedy demonstrated end to end before it was implemented); both vendor permission stores are honoured, with a no-grant control denied, and a workspace-scoped permissions block is ignored; a workspace-scoped MCP server is loaded and schema-cached but its tools are never declared to the model; and the prefix cache still engages under the production config, 93% of a ~30.6k prefix served from cache on each continuation. The two global vendor config files were backed up, mutated one arm at a time and restored byte-identical, verified by `sha256sum`; `agy mcp add` was never called and the schema cache the vendor wrote for the probe server was deleted afterwards.

Codex parked-call tolerance, probed 2026-09-02 against real `codex-cli` on `gpt-5.6-sol`, three runs, exploratory rather than a retained suite. One dynamic tool call was parked without answering for 60 s, 120 s and 180 s while every JSON-RPC line was logged in both directions. In all three the vendor waited, the continuation delivered the marker the model could only have read from the tool result, and `turn/completed` arrived only after DSH answered. Two facts came out of it: there is no short fixed timeout on an outstanding dynamic tool call, and the App Server emits a `reasoning` item every ~33 s while one is parked (36.0/68.8/101.7/134.7/168.5 s). Neither run reproduced the production abandonment, which is itself the finding — the tolerance is not a constant, and a small conversation survives longer than a ~154k-token one. See `ROADMAP.md` section 5.

Codex MCP blocking, probed 2026-09-02 against real `codex-cli 0.150.0` on `gpt-5.6-sol`, exploratory. A probe MCP server exposing one tool that sleeps 200 s was registered for a single `codex exec` invocation through `-c mcp_servers.*`, leaving `~/.codex/config.toml` untouched, and run with `--approve-for-me` (a first run without it failed on `MCP tool call requires approval, but approval policy is never`, which is itself the finding recorded in `ROADMAP.md` section 5). The server logged the call arriving at 14.0 s and released it at 214.0 s; the model answered with the marker obtainable only from that result, 216 s end to end, 11,965 tokens. So Codex holds a turn open across a blocking MCP call where it abandons a dynamic tool call. Confirmed on the App Server path the same day, which supersedes that caveat: a raw JSON-RPC probe drove `codex app-server --stdio`, declared the probe MCP server per-thread through `thread/start`'s `config` map (leaving `~/.codex/config.toml` untouched, verified after), answered the `mcpServer/elicitation/request` gate with `{ action: 'accept' }`, and saw the server receive `tools/call` at 9.4 s and release it at 209.4 s. The turn stayed open throughout and `turn/completed` returned `completed` at 212.4 s with the marker in both the `mcpToolCall` item and the model's answer. Two runs were spent learning the gate: with `approvalPolicy: 'never'` the vendor refuses an MCP tool call with no client request at all, and answering the elicitation with an approval-shaped `{ decision: 'approved' }` reads as a rejection.

Codex idle-token cost and its removal, probed 2026-09-02 on the App Server path, `codex-cli 0.150.0` / `gpt-5.6-sol`. Counting `thread/tokenUsage/updated` and comparing the thread's cumulative `total`, an 80 s blocked MCP call cost **109,091** tokens with five intervening billed model turns; the same block with `features.code_mode.direct_only_tool_namespaces = ["mcp__dshprobe"]` cost **30,545** with **zero**, that figure being exactly the two legitimate turns (15,240 to call, 15,305 to consume the result). **Those cumulative figures are unsound and were withdrawn on 2026-09-02**: they sum `tokenUsage.last.totalTokens` across requests, and each entry is that request's whole context rather than a delta, so the base prompt is counted once per request. The finding that survives is the EVENT count — zero billed model turns against five — because that is a count, not a token sum. The probes were also missing the production `isolationConfig()`, which inflated every absolute figure by roughly 12.5 k per request. See `ROADMAP.md` section 5. Read the raw numbers with the caching correction: an idle poll is ~97% cached input (one measured `input=15,471`, `cached=15,104`, 39 output), so at a typical 10% cached rate the two runs are ~18,100 against ~16,700 effective input — about 8% apart on a small conversation, and material only as extra-polls x context-size grows. That run set no `tool_timeout_sec`, so direct routing alone removes the polling.
A 600 s run then settled two more: `tool_timeout_sec = 7200` declared per-server carried the call well past the 300 s ceiling upstream raised `DEFAULT_TOOL_TIMEOUT` to, direct mode still produced zero billed turns across the full ten minutes, and the worry that removing the polls would let the prompt cache go cold was **refuted** — the resume turn read `cachedInputTokens=14,080` of `15,296` (92%) after ten minutes of silence, against 7,680 of 15,292 (50%) after 80 s. Both keys were passed through `thread/start`'s `config` map; `~/.codex/config.toml` was verified untouched after every run. These probes were exploratory and are not retained as a suite; the recipe is in `ROADMAP.md` section 5.

Cross-route delegation was also exercised end to end for the first time, in the real `web` profile (`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` bundles, the installed Orchestrator preset, and the user's `subagent-model-selection` setting enabled with both routes). Evidence is the durable session log, not the model's own claim: each child session records `origin: subagent` and a `request/header` naming its route, and the parent records the sampled `subagent/model-selection-policy`.

- parent `codex-app-server/gpt-5.6-sol` -> child `antigravity-cli/gemini-3.7-flash-medium`: PASS;
- parent `antigravity-cli/gemini-3.7-flash-medium` -> child `codex-app-server/gpt-5.6-sol`: PASS;
- one parent turn with two concurrent background children on `codex-app-server`: PASS, with up to six concurrent `codex app-server` processes observed and no process residue afterwards.

That run also found one defect, which is open and recorded in `ROADMAP.md` §2: changing the primary route mid-turn, between a step that emitted tool calls and the step that consumes their results, fails the turn with `codex-plugin-dsh: the current Codex turn has no user input`. The session recovered on its next turn; nothing was poisoned durably.

A local gate plus these live suites is still not an acceptance: there is no independent validation by a party that did not write the code, and no repeated alpha.1 runtime probe. Restoring a freeze claim requires producing that evidence against this tree.

The accepted evidence below is retained as history.

Accepted Foundation implementation HEAD:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Accepted Codex provider implementation validation:

```text
Codex provider independent validation PASS
Codex CLI: codex-cli 0.150.0 (tag rust-v0.150.0 / commit 3b3b4f8fb3f6403e72c2d0533ed0d2f309c59717)
DSH baseline: 0.1.1-rc.2 (commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
All 15 live acceptance scenarios PASS
```

Accepted status at that checkpoint (historical):

```text
Core: FROZEN
Project Memory: FROZEN
Codex: FROZEN
```

## Environment and compatibility baseline

Accepted local validation baseline:

- Node `v24.19.0`;
- pnpm `11.21.0`;
- local installed DSH workspace baseline `0.1.1-rc.2`;
- Linux/CachyOS, x86_64;
- GitHub Actions/hosted CI: **NOT USED**;
- Windows: **NOT TESTED**.

Authoritative compatibility target validated in a disposable upstream environment:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Actual upstream source/runtime contracts at that exact tag/commit remain primary truth when documentation lags.

Every declared production DSH peer, Foundation and provider alike, is now exactly:

```text
0.1.2-alpha.1
```

The rc.2 union was dropped from every declared contract. Provider packages do not inherit Foundation compatibility automatically — each moved to `0.1.2-alpha.1` on its own evidence.

## Accepted executable evidence

Fresh evidence on implementation HEAD `7cd4d5b17625f9b3a21b741555df6597fd9cb889`:

| Gate | Accepted result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| Core focused tests | `182/182` PASS |
| Core `check` | PASS |
| Core `build` | PASS |
| Project Memory focused tests | `64/64` PASS |
| Project Memory `check` | PASS |
| Project Memory `build` | PASS |
| workspace `test` | PASS |
| workspace `check` | PASS |
| workspace `build` | PASS |
| `pnpm verify:local` | PASS |
| repeated PM concurrency suites | 20/20 iterations PASS, 460 assertions total |
| lock/WAL residue inspection | PASS, zero unexpected remnants |
| bidirectional `@deepseek-ai/dsh-atomic-write` lock interoperability | PASS |
| disposable official alpha.1 runtime probes | PASS |
| hosted CI / GitHub Actions | NOT USED |
| Windows | NOT TESTED |

Workspace test counts recorded by the follow-up report were Core `182`, Project Memory `64`, Codex `31`, Suite `12`, Antigravity `7`, Claude `0`.

`pnpm verify:local` passed release-family verification, package-contract verification, Orchestrator validation, build, check, tests and local package packing.

### Follow-up race verification

The three suites that exposed the first validation failures were rerun 20 consecutive times:

- `atomic-write.test.ts`;
- `compound-transaction.test.ts`;
- `transaction-recovery.test.ts`.

Accepted result: 20/20 iterations passed with no leaked `ENOTEMPTY` / `ENOTDIR`, no concurrent-journal-open/unlink exception, and the expected fail-closed legacy owner-transfer error.

## Accepted Foundation remediation

### Project Memory

Accepted behavior now includes:

1. fixed journal pathname protected by random `transactionId` generation identity, expected-generation cleanup, and committed cleanup while participant locks remain held;
2. generation-safe populated directory writer locks with PID, random owner token and optional process-birth identity;
3. stale/finalizer lock removal conditional on the exact observed generation and directory identity;
4. PID-reuse hardening through Linux `/proc/<pid>/stat` start time and macOS process start time, with conservative fallback elsewhere;
5. bootstrap ingestion bounded before whole-file materialization;
6. recovery journal phase replacement preserving mode `0600` on POSIX;
7. domain-owned recovery with redundant tool-layer recovery removed;
8. writer-lock publication collision errno handled at the publishing `rename()` without a racy post-collision pathname re-stat for structural collision codes;
9. an opened journal concurrently unlinked before visible-identity recheck is treated as current namespace absence, while inode/symlink replacement still fails closed;
10. legacy journals without `transactionId` identify generation from immutable transaction payload while mutable owner PID/identity is checked separately.

The follow-up report independently reviewed lock ordering, ABA protection, path replacement behavior and transaction ownership separation and found no new blocking correctness defect.

### Core

Accepted behavior now includes:

1. destructive legacy-grant logout disabled/fail-closed because alpha.1 exposes no atomic compare-and-delete credential operation;
2. no `describeRecord()` then unconditional `deleteRecord()` mutation path for legacy logout;
3. browser legacy grant state is informational and has no destructive Sign Out action;
4. usage invalidation immediately removes host cache state and advances an observation generation;
5. pre-invalidation in-flight refresh cannot republish superseded state;
6. cached host reads omit invalidated state;
7. authoritative browser cache omission clears a prior local `FRESH` snapshot so `ensureFresh()` can refresh;
8. credential/backend secret material remains outside the browser RPC boundary.

## Disposable DSH `0.1.2-alpha.1` evidence

The exact upstream checkout at `cd5ef8148158c3a752a658978873241fdf8e2bbc` built successfully and the changed seams were exercised against alpha.1 runtime packages.

Accepted Project Memory probes:

- real `memory_write` with named topic + Memory-map update;
- real `memory_read` for named topic and bootstrap memory;
- real deterministic `memory_edit`;
- `ToolRunContext.signal` cancellation;
- unlocked pending recovery restoring exact pre-crash state;
- lock coordination/interoperability exercised through the validated suites.

Accepted Core probes:

- native alpha.1 two-argument Connection `rpc.handle(channel, handler)`;
- authorization status for unconfigured and legacy-grant state;
- fail-closed legacy logout with no credential deletion;
- usage invalidation/cache-drop behavior.

## First follow-up cycle — historical evidence

The first validation tested implementation HEAD:

```text
70a73869d4fa63f541906ca8b2669f2af089f46f
```

and correctly returned FAIL: Core was green, while Project Memory exposed writer-lock collision classification, concurrent journal unlink handling, and legacy recovery generation/ownership separation defects.

Narrow production fixes were applied at:

```text
e3f84ba5bfbfa75c6492919bdd8dfa9a31c98305
d1863d8712c68b369662cad081b57302300d0c5e
```

The canonical follow-up handoff update produced tested HEAD `7cd4d5b17625f9b3a21b741555df6597fd9cb889`, which then received the accepted PASS above.

## Superseded Foundation acceptance

Earlier accepted Foundation implementation checkpoint:

```text
eb95ef6425c788f63339befd0c2437f78bc8dde1
```

Earlier raw PASS report commit:

```text
f491d681390924a171211a5c0dd0c8991f6a7faf
```

That evidence remains historical for its exact checkpoint but was superseded by the later independent alpha.1 audit and the current accepted remediation checkpoint.

Older Core 01–16 and Project Memory PM01–PM05 acceptance details remain available through git history and continue to be useful only for their exact checkpoints.

## Accepted Codex provider validation

Accepted Codex provider implementation validation:

- **Codex CLI**: `codex-cli 0.150.0` (commit `3b3b4f8fb3f6403e72c2d0533ed0d2f309c59717`)
- **DSH baseline**: `0.1.1-rc.2` (commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`)
- **Focused tests**: `48/48` unit tests PASS
- **Live acceptance**: All 15 live acceptance scenarios PASS (`test-live/codex-acceptance-full.test.ts`):
  - Primary single request and multi-turn conversation
  - Dynamic DSH tools + real Project Memory tool execution + turn continuation
  - Routed native web search (`CodexSearchBackend.search()`)
  - Usage and rate-limits read (`OfficialCodexRateLimitsSource`)
  - Cancellation during active turn & tool continuation
  - Stale checkpoint / deleted vendor thread recovery from DSH history
  - Adversarial isolation against forbidden host capabilities (`HOST_CAPABILITIES_ISOLATED`)
  - Process tree cleanup (zero lingering `codex app-server --stdio` processes)

## Next open validation

Foundation and Codex are **not** frozen — see *Current validation status* above; both are THAWED, pending re-validation, and no independent (third-party) validation has happened against the current tree. Antigravity's own provider-specific audit, catalog rewrite, vendor-diagnostic routing, dedup and live acceptance are also complete (`docs/ROADMAP.md` §3); only its freeze declaration remains open, gated on the same independent validation as everything else. Ordered remaining work is now:

1. independent (third-party) validation of Core, Project Memory, Codex and Antigravity against the current tree, plus repeated alpha.1 runtime probes;
2. Claude usage-only cleanup + provider-specific compatibility/smoke (still not started);
3. repository-wide provider invariants;
4. cross-provider/product live acceptance;
5. final profile/install/release gates.

See `docs/ROADMAP.md` for task status and `docs/HANDOFF.md` for the immediate next run.
