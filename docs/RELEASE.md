# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / FOUNDATION FINAL REVALIDATION OPEN**

Current local acceptance baseline:

- DeepSeek Harness `0.1.1-rc.2`
- Node `24.x` (acceptance baseline `24.19.0`)
- pnpm `11.21.0`
- Linux/CachyOS development/acceptance environment
- Windows: **NOT TESTED**

Additional compatibility source target:

- official DSH tag `dsh-v0.1.2-alpha.1`
- commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

Core and Project Memory source/runtime blockers found by the alpha.1 audit are corrected and individually accepted. Their production DSH peers now declare the exact tested union:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Local dev dependencies remain pinned to rc.2; alpha.1 is validated from the official source/tag in disposable environments. Foundation publication/release status remains open until one final joint dual-generation validation passes.

This file is the only current release runbook/status document. Historical rc.1/rc.2 release notes are available in git history if needed.

## rc.3 family

Exactly six packages move together at `0.1.0-rc.3`:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

`0.1.0-rc.1` remains the published npm family. rc.2 was deliberately left unpublished.

The Core/Project Memory peer-family reconciliation does not by itself broaden provider-package DSH ranges. Codex, Antigravity and Claude still follow their own cleanup/freeze blocks before the six-package family can be release-ready.

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

## Foundation evidence

Accepted rc.2-baseline foundation evidence includes:

- local workspace test/check/build and accepted `verify:local` checkpoints;
- six rc.3 tarballs and disposable Suite install/reinstall closure at historical checkpoints;
- installed Core subpath imports;
- real DSH host boot and HTTP readiness;
- real agent-plane `nishi-dsh-core/web-search` mount;
- Core unload/remount without duplicate registry/RPC services;
- provider-neutral synthetic fourth-provider proof;
- Project Memory nested-root consistency;
- atomic-write dependency resolution in installed Suite profile;
- Project Memory Cordis command injection and real DSH boot.

Accepted reopened-audit evidence additionally includes:

- Core 15 Connection/client migration against rc.2 + alpha.1;
- Core 16 registry observer/registration transaction integrity;
- PM03 maintenance first-request model-selection timing;
- PM04 cross-process same-file RMW locking;
- PM05 compound topic + Memory-map transaction preflight/rollback integrity;
- disposable alpha.1 source/runtime probes for all changed seams.

The only remaining foundation gate is the final combined validation of the completed Core + Project Memory against both declared DSH generations.

## Open release work

Before rc.3 can be release-ready:

- pass the final Core + Project Memory supported-family re-freeze;
- freeze Codex, Antigravity and Claude;
- run cross-provider product acceptance;
- run final target-profile install/update/remove lifecycle;
- run managed Orchestrator preset lifecycle;
- recheck final package dependency ranges across the whole six-package family after provider freezes.

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

It may advertise only behavior proven by the final released build. It must not advertise retired vendor-specific subagents, automatic preset discovery, or compatibility with a DSH version/range that has not passed the final release gates.

Current Market gates:

- [x] repository PR #1 merged historically;
- [x] repository has sufficient commit history;
- [ ] final foundation supported-family re-freeze PASS;
- [ ] repository topic `dsh-plugin` added;
- [ ] rc.3 family published consistently to npm;
- [ ] final deterministic/local/live release gates PASS;
- [ ] final install/update/uninstall acceptance PASS;
- [ ] Windows acceptance if a Windows compatibility claim is desired;
- [ ] Market description rechecked against the exact released install path.

## Publication authorization

**No rc.3 publication approval has been given.**

Do not publish packages, merge the rc.3 feature branch, create a tag/release, or deprecate npm packages merely because technical gates pass. Request explicit maintainer approval after all required gates are complete.
