# CachyOS DSH runtime acceptance — 2026-08-26

Status: **PASS (LOCAL EXECUTION REPORT)**

This record captures the executed local CachyOS runtime acceptance reported for the exact repository state below. The execution was performed locally with a temporary isolated `DSH_HOME`; no real user DSH home or vendor credential store was used.

## Environment

- repository HEAD under test: `a5d449a0b6588b270fe31d4d9fbdfca7ccde70d4`
- OS: CachyOS Linux, x86_64, kernel `7.2.0-1-cachyos`
- Node.js: `v24.19.0`
- pnpm: `11.21.0`
- DeepSeek Harness: `0.1.1-rc.2`

## Deterministic gate

- `pnpm verify:local`: **PASS**

## Fresh profile / bundle composition

- fresh profile install: **PASS**
- DSH config dump: **PASS**
- `@deepseek-ai/dsh-authorization`: present
- `nishi-dsh-project-memory`: present
- `nishi-dsh-codex`: present
- `nishi-dsh-antigravity`: present
- `nishi-dsh-claude-code`: present
- `nishi-dsh-usage-limits-host`: present
- duplicate host-global `web_search`: absent

## Orchestrator preset bridge

- initial status `absent`: **PASS**
- `preset install`: **PASS**
- status `current`: **PASS**
- idempotent second install: **PASS**
- same-version update: **PASS**
- ownership marker + SHA-256 manifest: **PASS**
- no leftover staging/backup directories: **PASS**
- DSH discovers the Orchestrator through the user preset root: **PASS**

## Safety

- unmanaged `orchestrator` directory protected from overwrite: **PASS**
- local modification detected as `modified`: **PASS**
- modified preset update refused: **PASS**
- modified preset removal refused: **PASS**

## Removal / preservation

- managed preset removal: **PASS**
- Suite uninstall: **PASS**
- sibling user preset preserved: **PASS**
- unrelated session sentinel preserved: **PASS**
- test project files preserved: **PASS**
- project memory sentinel preserved: **PASS**

No source fixes were required by this runtime acceptance; the reported final Git status was clean.

## Remaining gates

This acceptance does **not** cover live provider behavior. Still pending on CachyOS:

- Codex primary/subagent/routed-search live gate;
- Claude Code subagent live gate;
- Antigravity primary/subagent/routed-search live gate;
- Project Memory behavior through the live provider bridges;
- Usage & Limits live/runtime/UI behavior.

Independent Windows acceptance is also still pending.

GitHub-hosted Actions remain externally blocked by the account billing issue. DSH `0.1.1-rc.2` also still lacks automatic one-click discovery for third-party package preset roots; issue #2 remains the upstream tracking item. The explicit managed user-preset bridge passed this CachyOS acceptance.
