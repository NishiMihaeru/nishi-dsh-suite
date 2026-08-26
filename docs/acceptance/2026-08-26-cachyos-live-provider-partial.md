# CachyOS live-provider acceptance — partial evidence

Date: 2026-08-26

Status: **PARTIAL / RERUN_REQUIRED_NODE24 / CODEX_PRIMARY_PACKAGING_GAP**

This record captures an executed live-provider probe supplied from CachyOS. It is useful runtime evidence, but it is **not** a full release acceptance because the run used Node `v22.23.2`, while Nishi DSH Suite declares and releases against Node `>=24 <25`.

## Environment

- Repository HEAD under test: `933e126c748025f4ac5afc83f51c2c6448603ace`
- OS: CachyOS Linux, kernel `7.2.0-1-cachyos`, x86_64
- Node: `v22.23.2` — **outside Suite release contract**
- pnpm: `11.21.0`
- DSH: `0.1.1-rc.2`
- `DEEPSEEK_API_KEY`: unset for routed-search probes
- temporary isolated `DSH_HOME`; real `~/.dsh` reported untouched

`pnpm verify:local` was reported PASS during this run, but Node-22 execution does not replace the already-recorded Node-24 deterministic acceptance and must not be used to broaden the package engine contract.

## Evidence observed

### Codex

- package-managed `@openai/codex@0.147.0` runtime resolved successfully;
- `subagent_codex`: **PASS** for a bounded exact-response prompt;
- Codex subagent Project Memory sentinel read: **PASS**;
- Project Memory files remained byte-for-byte unchanged: **PASS**;
- primary-routed Suite `web_search`: **PASS** through the Codex-native backend with no DeepSeek/Exa/Perplexity fallback;
- Codex usage source: **AVAILABLE** and returned normalized Plus-plan windows without reported credential leakage.

The attempted primary turn is **NOT ACCEPTED** as a Codex-primary gate. It exercised DSH provider `openai-codex` and failed with `PI_AI_ERROR: Provider is not configured: openai-codex`. The accepted Nishi route is `codex-app-server`, provided by pinned external plugin `codex-plugin-dsh`, not the stock/direct `openai-codex` adapter.

### Claude Code

- official Agent SDK runtime was present;
- subagent live query: **BLOCKED_AUTH** with product-owned `Not logged in · Please run /login`;
- model/effort/permission static/runtime argument contract was observed as `claude-sonnet-5`, effort `high`, permission mode `auto`;
- Project Memory bridge remained read-only and files were unchanged.

No credential workaround is permitted; rerun only after normal Claude Code authentication if the operator chooses to authenticate the official client.

### Antigravity

- official `agy` executable: **MISSING**;
- primary/subagent/routed-search live gates therefore remain **RUNTIME_MISSING**;
- dangerous permission-skip flags were reported absent;
- Project Memory remained unchanged.

The Antigravity Usage source independently reported AVAILABLE quota data. This is not contradictory: that source uses the separate accepted local read-only quota seam and can attach to an existing local Antigravity runtime without proving the `agy` inference CLI is installed.

### Search and isolation

- unsupported primary search route -> explicit `WEB_SEARCH_UNSUPPORTED`: **PASS**;
- no DeepSeek fallback observed: **PASS**;
- missing-client isolation for Codex/Claude/agy: **PASS** as reported; DSH/Suite continued starting while the corresponding integration failed safely.

### Usage & Limits / Web

- Codex collector AVAILABLE;
- Claude collector failure isolated without crashing the service;
- Antigravity local quota collector AVAILABLE;
- public/browser projection redaction: **PASS** as reported (no raw token, cookie, credential record, local auth DB path, or internal source metadata);
- DSH Web served root HTML and Suite plugins mounted: **PASS**.

### Cleanup / preservation

- Project Memory sentinel hashes unchanged before/after;
- managed preset removal: PASS;
- Suite uninstall: PASS;
- temporary DSH home removed;
- real vendor auth/config reported untouched;
- working tree reported clean.

## Newly exposed migration gap: Codex primary packaging

The accepted private product contract and migration roadmap require one Nishi DSH Suite install to provide **Codex primary** while authentication remains owned by the official Codex client.

Current public `nishi-dsh-codex` does not itself register a primary LLM adapter. Its primary-history bridge looks for package `codex-plugin-dsh` and returns `false` when that package is absent. Current `nishi-dsh-codex/package.json` and the Suite composition do not install/mount `codex-plugin-dsh`.

The accepted primary provider is `codex-app-server`. Upstream `wingoo/codex-plugin-dsh` registers exactly that route and uses the native Codex App Server authentication boundary. Its current/accepted repository head as of this migration window is `79fe7503390d641680bad8efade52782a3c31ced`; release work must pin a tested commit rather than float on `main`.

This is a **migration packaging gap**, not an instruction to fall back to `openai-codex` or add DSH-owned subscription OAuth.

## Release-gate status after this probe

- CachyOS deterministic Node-24 gates: previously PASS and remain the release evidence.
- CachyOS isolated Suite install/preset/uninstall: previously PASS.
- Codex subagent/search/usage live evidence: observed, but rerun under Node 24 is required for final live-provider acceptance.
- Codex primary: **PENDING_FIX / correct `codex-app-server` route not installed by Suite**.
- Claude Code subagent: **BLOCKED_AUTH**.
- Antigravity inference/search: **RUNTIME_MISSING (`agy`)**.
- Usage & Limits runtime/redaction: useful live evidence observed; final release acceptance should be repeated under Node 24 alongside the corrected provider composition.

Do not mark the complete CachyOS live-provider row PASS until the Node-24 rerun exercises the correct `codex-app-server` route and the available vendor clients.