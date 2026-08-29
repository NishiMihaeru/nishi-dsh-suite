# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / FOUNDATION REVALIDATION ACTIVE**

Current development baseline:

- Node `24.x` (previous acceptance baseline `24.19.0`)
- pnpm `11.21.0`
- local package devDependency graph: DSH `0.1.1-rc.2`
- Linux/CachyOS development environment
- Windows: **NOT TESTED**

Authoritative compatibility target for the current Foundation audit/remediation:

- official tag `dsh-v0.1.2-alpha.1`
- commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

Core and Project Memory still publish the exact production peer union:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Because the main dev graph is rc.2, the changed Foundation must be exercised explicitly against official alpha.1 before that support claim is re-accepted.

This file is the current release runbook/status document. Historical rc.1/rc.2 notes and superseded validation detail remain in git history/verification evidence.

## rc.3 family

Exactly six packages move together at `0.1.0-rc.3`:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

`0.1.0-rc.1` remains the published npm family. rc.2 was deliberately left unpublished.

## Foundation state — REOPENED

A new independent audit against exact alpha.1 found additional concrete Core/Project Memory correctness defects after the previous accepted Foundation checkpoint.

The current branch now contains remediation for:

- Project Memory journal-generation cleanup race;
- Project Memory stale-lock replacement race;
- Project Memory PID-reuse recovery wedge;
- Core legacy logout credential read-check-delete TOCTOU;
- Project Memory unbounded bootstrap ingestion;
- Core ineffective usage-cache invalidation/browser reconciliation;
- Project Memory committed-journal permission widening.

It also removes redundant tool-layer Project Memory recovery and adds explicit lock/transaction generation identities.

Historical Foundation validation at implementation checkpoint:

```text
eb95ef6425c788f63339befd0c2437f78bc8dde1
```

and historical raw PASS report:

```text
f491d681390924a171211a5c0dd0c8991f6a7faf
```

remain useful evidence for that exact old checkpoint only. They do **not** validate the current branch head.

Current Foundation release state:

```text
Core: REOPENED / PENDING VERIFICATION
Project Memory: REOPENED / PENDING VERIFICATION
```

Required new Foundation gates before provider work/release work resumes:

- [ ] exact-head `pnpm install --frozen-lockfile`;
- [ ] Core focused test/check/build;
- [ ] Project Memory focused test/check/build, including new audit regressions;
- [ ] full workspace test/check/build;
- [ ] `pnpm verify:local`;
- [ ] multi-process/adversarial lock/WAL/recovery/cancellation runs;
- [ ] bidirectional compatibility with `@deepseek-ai/dsh-atomic-write` lock namespace;
- [ ] official disposable alpha.1 runtime validation at exact upstream commit;
- [ ] real alpha.1 Project Memory tool operations;
- [ ] Core usage invalidation and fail-closed legacy-grant behavior in the real host/client seam;
- [ ] independent Gemini code review of the changed seams;
- [ ] raw result written to `docs/verification/gemini/LATEST.md`;
- [ ] accepted durable evidence folded into `docs/verification/README.md`;
- [ ] explicit Foundation re-freeze after PASS.

GitHub Actions/hosted CI are not part of these gates.

## Main rc.3 product direction

The Suite has one provider-independent Core plus one plugin per provider. Project Memory remains separate/provider-agnostic.

Vendor-specific delegation tools are removed. Orchestrator uses DSH-native `subagent` / `subagent_fork` on the active primary route.

Provider routes preserved for compatibility:

```text
codex-app-server
antigravity-cli
```

Claude is usage-only and has no Nishi model route/search backend.

The old `ctx.projectMemory` delegated service boundary is gone. Memory is exposed through ordinary DSH `memory_read`, `memory_write`, `memory_edit` plus `/memory` and `/consolidate` maintenance commands.

## Open release work

After Foundation re-freeze:

1. freeze Codex after provider-specific cleanup/compatibility/live acceptance;
2. freeze Antigravity after cleanup/catalog/compatibility/live acceptance;
3. freeze Claude after usage-only cleanup/compatibility/smoke;
4. recheck repository-wide provider invariants and dependency declarations;
5. run cross-provider product acceptance;
6. run final profile install/update/remove lifecycle;
7. run managed Orchestrator preset lifecycle;
8. run final deterministic/local/vendor/bundle/name release gates.

Product live acceptance must still cover Codex primary/search/vendor-memory suppression, Antigravity primary/model switch/search, Codex -> Antigravity switch in one session, Project Memory continuity, and live Usage & Limits dynamic-roster cases.

## Final release commands

Run after the last implementation/dependency change:

```bash
pnpm install --frozen-lockfile
pnpm verify:local
pnpm smoke:vendor-cli
pnpm verify:bundle-install
pnpm check:npm-names
```

Read real exit codes; do not mask failures through pipelines.

## Security/runtime release boundary

Release must continue to satisfy:

- no vendor credential/session/token store copied, parsed, migrated or deleted;
- no unsafe read-check-delete legacy credential mutation;
- no `@openai/codex*` or `@anthropic-ai/*` runtime dependency in the Suite graph unless separately reviewed;
- vendor sign-in stays inside official vendor products;
- no silent provider fallback for routed search;
- Project Memory path/symlink confinement remains fail-closed;
- no Windows support claim before Windows acceptance.

## Orchestrator preset distribution

Until separately changed by compatibility work, the supported rc.3 path remains the explicit managed bridge:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Use `preset update` after a Suite update and `preset remove` before Suite removal. Do not describe this as automatic one-click preset discovery.

## Market submission

Prepared registry template:

```text
docs/market/awesome-dsh-plugin-entry.yml
```

It may advertise only behavior proven by the final released build.

Current Market gates:

- [x] repository PR #1 merged historically;
- [x] repository has sufficient commit history;
- [ ] Core + Project Memory new Foundation revalidation PASS;
- [ ] Codex frozen;
- [ ] Antigravity frozen;
- [ ] Claude frozen;
- [ ] repository topic `dsh-plugin` added;
- [ ] rc.3 family published consistently to npm;
- [ ] final deterministic/local/live release gates PASS;
- [ ] final install/update/uninstall acceptance PASS;
- [ ] Windows acceptance if a Windows compatibility claim is desired;
- [ ] Market description rechecked against the exact released install path.

## Publication authorization

**No rc.3 publication approval has been given.**

Do not publish packages, merge the rc.3 feature branch, create a tag/release, or deprecate npm packages merely because technical gates pass. Request explicit maintainer approval after all required gates are complete.
