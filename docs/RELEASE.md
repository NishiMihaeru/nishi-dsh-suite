# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / PROVIDER-LIVE ACCEPTANCE OPEN**

Compatibility baseline:

- DeepSeek Harness `0.1.1-rc.2`
- Node `24.x` (acceptance baseline `24.19.0`)
- pnpm `11.21.0`
- Linux/CachyOS development/acceptance environment
- Windows: **NOT TESTED**

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

## Main rc.3 change

The Suite now has one provider-independent core plus one plugin per provider. Project Memory remains separate and provider-agnostic.

Vendor-specific delegation tools are removed. Orchestrator uses DSH-native `subagent` / `subagent_fork` on the active primary route.

Retired published/experimental boundaries include the old Claude Code subagent, usage-limits helper packages, primary-web-search package, Codex usage-source package and intermediate provider-kit boundary. Do not deprecate npm names until release/deprecation is explicitly approved.

Provider routes preserved for compatibility:

```text
codex-app-server
antigravity-cli
```

Claude is usage-only and has no Nishi model route/search backend.

The old `ctx.projectMemory` delegated service boundary is gone. Current memory surface is ordinary DSH `memory_read`, `memory_write`, `memory_edit` plus `/memory` and `/consolidate` maintenance commands.

## Accepted foundation

Core and Project Memory are frozen after local/package and real DSH acceptance.

Accepted foundation evidence includes:

- `pnpm verify:local` PASS at accepted checkpoints;
- six rc.3 tarballs;
- disposable Suite install/reinstall closure;
- installed Core subpath imports;
- real DSH host boot and HTTP readiness;
- real agent-plane `nishi-dsh-core/web-search` mount;
- Core unload/remount without duplicate registry/RPC services;
- provider-neutral synthetic fourth-provider proof;
- Project Memory nested-root consistency;
- atomic-write dependency resolution in installed Suite profile;
- Project Memory Cordis command injection and real DSH boot.

This foundation evidence does not replace the final provider/product live run after remaining provider changes.

## Open release work

Provider-specific work is tracked only in `ROADMAP.md`. Before rc.3 can be release-ready, all providers must be frozen and the product-level live run must cover:

- Codex primary/search/vendor-memory suppression;
- Antigravity primary/model switch/search;
- Codex -> Antigravity switch inside one session;
- Project Memory continuity across that switch;
- live Usage & Limits dynamic-roster cases;
- final target-profile install/update/remove lifecycle;
- managed Orchestrator preset lifecycle.

## Final release commands

Run after the last provider change:

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

DSH `0.1.1-rc.2` does not reliably preserve third-party contributed preset roots. The supported rc.3 path therefore remains the explicit managed bridge:

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

Current description may advertise:

- Codex and Antigravity primary integrations;
- Claude usage visibility;
- routed web search;
- Project Memory;
- Usage & Limits;
- managed Orchestrator preset bridge with DSH-native delegation.

It must not advertise retired vendor-specific subagents or automatic preset discovery.

Current Market gates:

- [x] repository PR #1 merged historically;
- [x] repository has sufficient commit history;
- [ ] repository topic `dsh-plugin` added;
- [ ] rc.3 family published consistently to npm;
- [ ] final deterministic/local/live release gates PASS;
- [ ] final install/update/uninstall acceptance PASS;
- [ ] Windows acceptance if a Windows compatibility claim is desired;
- [ ] Market description rechecked against the exact released install path.

## Publication authorization

**No rc.3 publication approval has been given.**

Do not publish packages, merge the rc.3 feature branch, create a tag/release, or deprecate npm packages merely because the technical gates pass. Request explicit maintainer approval after all required gates are complete.
