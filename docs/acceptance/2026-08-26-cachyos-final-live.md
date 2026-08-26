# CachyOS final live-provider acceptance — 2026-08-26

Status: **PASS — CachyOS live runtime complete**

Executed against repository HEAD `a5766642cfd6762fba51f764d39ab0c9a9a36336` on CachyOS Linux x86_64, kernel `7.2.0-1-cachyos`, with Node `v24.19.0` through fnm while system `/usr/bin/node` remained `v22.23.2`, pnpm `11.21.0`, and DeepSeek Harness `0.1.1-rc.2`.

Vendor runtimes used for this final gate:

- Claude Code `2.1.246`, authenticated through the normal product login flow;
- `agy` `1.1.21`, authenticated through its normal product flow.

This record captures an operator-executed live acceptance report. No repository code changes were required by the run and the working tree remained clean.

## Deterministic baseline

- `pnpm verify:local`: **PASS** under Node 24.

## Claude Code

Status: **PASS**.

- `subagent_claude_code` completed the bounded prompt with exact output `CLAUDE_SUBAGENT_OK`.
- model: `claude-sonnet-5`.
- effort: `high`.
- permission mode: `auto`.
- Project Memory sentinel `NISHI_FINAL_CACHYOS_SENTINEL_5c7a9385da9a` was read successfully through the accepted child path.
- Project Memory SHA-256 values were unchanged before and after the child run.

## Antigravity

Status: **PASS**.

- primary provider completed the bounded prompt with exact output `ANTIGRAVITY_PRIMARY_OK`.
- `subagent_antigravity` completed the bounded prompt with exact output `ANTIGRAVITY_SUBAGENT_OK`.
- routed `web_search`: **PASS**.
- `agy` backend confirmed at `/home/acedia/.local/bin/agy` through the DSH web-search agent boundary.
- `DEEPSEEK_API_KEY` remained unset.
- no DeepSeek, Exa, or Perplexity fallback was observed.
- no dangerous permission-skip flag or equivalent bypass was present.
- Project Memory sentinel `NISHI_FINAL_CACHYOS_SENTINEL_5c7a9385da9a` was read successfully.
- Project Memory SHA-256 values remained unchanged.

## Project Memory aggregate

Status: **PASS**.

All three accepted child-provider paths have now executed successfully on CachyOS Node 24:

- Codex child: PASS from the previously accepted Codex live gate;
- Claude Code child: PASS;
- Antigravity child: PASS.

Byte-for-byte SHA-256 preservation was confirmed across the executed child-provider paths. No provider child mutated project memory.

## Usage & Limits smoke

Status: **PASS**.

- Codex: `AVAILABLE`, four windows observed.
- Claude: `AVAILABLE`, two windows observed.
- Antigravity: `AVAILABLE`, four windows observed.
- DSH Web UI returned HTTP 200.

The fuller browser projection/redaction and provider-isolation acceptance was already recorded in `docs/acceptance/2026-08-26-cachyos-remaining-live.md`; this final run was a regression smoke after normal Claude and `agy` authentication became available.

## Uninstall and preservation

Status: **PASS**.

- managed Orchestrator preset removed;
- Suite uninstalled;
- temporary profile dependencies cleaned;
- real `~/.dsh` remained untouched;
- vendor auth/config remained untouched;
- Project Memory remained unchanged.

## CachyOS conclusion

The CachyOS live runtime release gates are complete for:

- deterministic verification;
- fresh Suite install and composition;
- Orchestrator managed-preset bridge;
- Codex primary/subagent/search;
- Claude Code subagent;
- Antigravity primary/subagent/search;
- Project Memory provider bridge;
- Usage & Limits runtime/UI;
- missing-client isolation;
- uninstall/preservation.

Remaining project-level blockers are not CachyOS runtime failures:

- GitHub Actions billing lock;
- upstream DSH rc.2 one-click preset discovery issue #2;
- independent Windows acceptance;
- real version-to-version update acceptance after a second Suite RC exists.
