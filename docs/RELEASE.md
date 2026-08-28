# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / PROVIDER FREEZE WORK ACTIVE**

Current local acceptance baseline:

- DeepSeek Harness `0.1.1-rc.2`
- Node `24.x` (acceptance baseline `24.19.0`)
- pnpm `11.21.0`
- Linux/CachyOS development/acceptance environment
- Windows: **NOT TESTED**

Additional compatibility source target:

- official DSH tag `dsh-v0.1.2-alpha.1`
- commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

Core and Project Memory are re-frozen. Their production DSH peers accept exactly:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Local dev dependencies remain pinned to rc.2; alpha.1 evidence comes from official source/runtime probes in disposable environments.

This foundation range does **not** automatically broaden provider packages or the complete Suite. Codex, Antigravity and Claude still require provider-specific compatibility/freeze work.

This file is the only current release runbook/status document. Historical rc.1/rc.2 release notes and superseded foundation reports remain in git history.

## rc.3 family

Exactly six packages move together at `0.1.0-rc.3`:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

`0.1.0-rc.1` remains the published npm family. rc.2 was deliberately left unpublished.

## Main rc.3 change

The Suite has one provider-independent core plus one plugin per provider. Project Memory remains separate and provider-agnostic.

Vendor-specific delegation tools are removed. Orchestrator uses DSH-native `subagent` / `subagent_fork` on the active primary route.

Provider routes preserved for compatibility:

```text
codex-app-server
antigravity-cli
```

Claude is usage-only and has no Nishi model route/search backend.

The old `ctx.projectMemory` delegated service boundary is gone. Current memory surface is ordinary DSH `memory_read`, `memory_write`, `memory_edit` plus `/memory` and `/consolidate` maintenance commands.

## Foundation evidence — ACCEPTED

Accepted foundation implementation checkpoint:

```text
eb95ef6425c788f63339befd0c2437f78bc8dde1
```

Raw PASS report commit:

```text
f491d681390924a171211a5c0dd0c8991f6a7faf
```

Accepted final foundation gates:

- `pnpm install --frozen-lockfile` PASS;
- Core `178/178` focused tests + check/build PASS;
- Project Memory `57/57` focused tests + check/build PASS;
- full workspace test/check/build PASS;
- `pnpm verify:local` PASS, including release-family/package-contract/orchestrator checks and local packing of all six rc.3 packages;
- official disposable `dsh-v0.1.2-alpha.1` runtime compatibility PASS for the changed Core and Project Memory seams;
- real alpha.1 Project Memory `memory_read`, `memory_write` and `memory_edit` PASS;
- descriptor-chain replacement, cancellation, mandatory-settlement, WAL recovery and recovery fail-closed regressions PASS;
- working-tree integrity PASS during the validation run;
- GitHub Actions/hosted CI NOT USED;
- Windows NOT TESTED.

The report commit is documentation-only; the implementation actually tested and accepted is `eb95ef6425c788f63339befd0c2437f78bc8dde1`.

Foundation state:

```text
Core: FROZEN
Project Memory: FROZEN
```

Provider-specific work must not reopen the foundation without a new concrete defect or compatibility failure.

## Open release work

Before rc.3 can be release-ready:

1. freeze Codex after provider-specific cleanup, compatibility and live acceptance;
2. freeze Antigravity after cleanup/catalog/compatibility/live acceptance;
3. freeze Claude after usage-only cleanup/compatibility/smoke;
4. recheck repository-wide provider invariants and whole-family DSH package declarations;
5. run cross-provider product acceptance;
6. run final target-profile install/update/remove lifecycle;
7. run managed Orchestrator preset lifecycle;
8. run final deterministic/local/vendor/bundle/name release gates.

Product live acceptance must still cover:

- Codex primary/search/vendor-memory suppression;
- Antigravity primary/model switch/search;
- Codex -> Antigravity switch inside one session;
- Project Memory continuity across that switch;
- live Usage & Limits dynamic-roster cases.

## Final release commands

Run after the last implementation/dependency change:

```bash
pnpm install --frozen-lockfile
pnpm verify:local
pnpm smoke:vendor-cli
pnpm verify:bundle-install
pnpm check:npm-names
```

Read each command's real exit code. Do not hide failures through pipelines.

## Security/runtime release boundary

Release must continue to satisfy:

- no vendor credential/session/token store copied, parsed, migrated or deleted;
- no `@openai/codex*` or `@anthropic-ai/*` runtime dependency in the Suite graph;
- vendor sign-in stays inside official vendor products;
- no silent provider fallback for routed search;
- Project Memory path/symlink confinement remains fail-closed;
- no Windows support claim before Windows acceptance.

## Orchestrator preset distribution

The installed rc.2 baseline does not reliably preserve third-party contributed preset roots. Until compatibility work deliberately changes this, the supported rc.3 path remains the explicit managed bridge:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Use `preset update` after a Suite update and `preset remove` before Suite removal. Do not describe this workaround as automatic one-click preset discovery.

## Market submission

The prepared registry template is:

```text
docs/market/awesome-dsh-plugin-entry.yml
```

It may advertise only behavior proven by the final released build. It must not advertise retired vendor-specific subagents, automatic preset discovery, or compatibility with a DSH version/range that has not passed the relevant provider/family release gates.

Current Market gates:

- [x] repository PR #1 merged historically;
- [x] repository has sufficient commit history;
- [x] Core + Project Memory foundation re-freeze PASS;
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
