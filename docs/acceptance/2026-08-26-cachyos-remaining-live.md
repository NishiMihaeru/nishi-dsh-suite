# CachyOS remaining live-provider acceptance — 2026-08-26

Status: **PARTIAL PASS — external Claude/Antigravity inference blockers remain**

Executed against repository HEAD `6bbd600c352fdedc66497fde4b7b02fbc90c6584` on CachyOS Linux with Node `v24.19.0` through fnm, system `/usr/bin/node` remaining `v22.23.2`, pnpm `11.21.0`, and DSH `0.1.1-rc.2`.

## Deterministic baseline

- `pnpm verify:local`: **PASS**.
- No code fixes were required by this live run.
- Final working tree remained clean.

## Vendor readiness

### Claude Code

Status: **BLOCKED_AUTH**.

The official Agent SDK runtime is present, but the normal product CLI reports `Not logged in · Please run /login`. No credential files were read, copied, or replayed and no auth workaround was attempted.

The runtime/config contract still confirmed:

- model `claude-sonnet-5`;
- effort `high`;
- permission mode `auto`;
- authentication failure is isolated as an error stop without crashing DSH/Suite.

The Project Memory MCP/read path remains declared read-only and memory hashes remained unchanged during the failed-auth probe, but the Claude child inference/read gate is not counted as a live PASS until normal product login succeeds.

### Antigravity

Status: **BLOCKED_RUNTIME_MISSING** for inference/search.

The official `agy` executable was not present on PATH. No unofficial replacement or credential workaround was installed. Therefore these rows remain blocked:

- Antigravity primary;
- `subagent_antigravity`;
- Antigravity-routed `web_search`;
- Antigravity child Project Memory inference/read gate.

Static/runtime configuration inspection confirmed no dangerous permission-skip flag such as `--dangerously-skip-permissions`.

## Usage & Limits

Status: **PASS on CachyOS**.

The Usage & Limits service started under DSH Web and provider groups remained independent:

- Codex: `AVAILABLE`, ChatGPT Plus 5-hour and weekly windows read through the accepted local App Server source;
- Claude: isolated `ERROR` while unauthenticated, with no service crash;
- Antigravity: `AVAILABLE` through the existing local Antigravity IDE/App language-server quota seam, returning four numeric quota windows.

Browser-facing projection/redaction was checked and did not expose raw tokens, cookies, passwords, credential database paths, vendor stderr, internal loopback ports, CSRF material, or internal collector/source metadata.

DSH Web returned HTTP 200 and the Usage Limits / Model Accounts surfaces registered their expected sidebar/settings slots. Failure of the Claude collector did not hide Codex or Antigravity state.

## Missing-client isolation

Status: **PASS**.

- Missing global `codex`: DSH/Suite still starts and managed Codex primary resolves package-owned `@openai/codex@0.147.0` rather than relying on global PATH.
- Missing `claude`: DSH Web and Usage service still start; Claude integration fails in isolation.
- Missing `agy`: DSH Web and Usage service still start; inference/search remains unavailable while the independent local Antigravity quota source can still operate if the IDE runtime is present.

## Project Memory aggregate

Status: **PENDING**.

- Codex child path: previously accepted PASS on Node 24.
- Claude child inference/read path: `BLOCKED_AUTH`.
- Antigravity child inference/read path: `BLOCKED_RUNTIME_MISSING`.

All memory files observed in this run preserved their SHA-256 values and no executed child/failure path mutated project memory. Full aggregate PASS requires normal Claude login plus official `agy` installation/authentication and successful child reads.

## Search routing

- `DEEPSEEK_API_KEY`: unset.
- No DeepSeek/Exa/Perplexity fallback was observed.
- Antigravity `agy search_web` live route remains blocked only because `agy` is missing.

## Preservation and cleanup

- Project Memory hashes unchanged: **PASS**.
- Real `~/.dsh` profile files unchanged: **PASS**.
- Vendor auth/config state untouched: **PASS**.
- Temporary profile/project fixtures removed: **PASS**.

## Remaining external blockers

- Claude Code normal product authentication (`/login`).
- Official `agy` executable/runtime installation and authentication for Antigravity inference/search.
- GitHub Actions billing lock.
- DSH rc.2 upstream one-click preset discovery issue #2.
- Independent Windows acceptance.
- Real version-to-version Suite update acceptance after a second RC exists.
