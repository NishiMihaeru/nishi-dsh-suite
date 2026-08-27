# Nishi DSH Suite prerelease runbook

Target release train: `0.1.0-rc.2`.

Status: **IN PROGRESS**. This runbook documents the accepted state of the working tree; publication has not happened yet and is gated on explicit maintainer approval (see Stage 0.6 in `docs/ROADMAP.md`).

Release scope for this RC: **CachyOS/Linux validated; Windows not tested and not claimed.**

This document continues `docs/release/prerelease.md` (the `0.1.0-rc.1` runbook). It does not repeat gates that carry over unchanged; it records what is new or different for rc.2.

## Breaking change — read this first

**Upgrading from `0.1.0-rc.1` removes the `subagent_claude_code` tool from the Orchestrator preset.**

Claude is no longer an agent provider in this suite. The Claude Code subagent, its stream-json run loop, and its loopback MCP project-memory bridge are removed. Only the Claude usage/limits source survives, carried by the new standalone `nishi-dsh-claude-usage-source` package.

Claude usage and limits **remain visible** in the Usage & Limits surface — this change removes an agent-invocation tool, not the usage row. If the `claude` CLI is absent, the Claude usage row degrades explicitly rather than failing silently (see Stage 0.4 in `docs/ROADMAP.md`).

Reference commit for this change: `feat(claude)!: replace Claude Code subagent with a usage-only source package` (`bdaab7b`).

## Family roster for `0.1.0-rc.2`

Nine packages, one prerelease train:

1. `nishi-dsh-codex`
2. `nishi-dsh-antigravity`
3. `nishi-dsh-claude-usage-source` — **new name**, replaces `nishi-dsh-claude-code`
4. `nishi-dsh-project-memory`
5. `nishi-dsh-usage-limits`
6. `nishi-dsh-codex-usage-source`
7. `nishi-dsh-primary-web-search`
8. `nishi-dsh-usage-limits-host`
9. `nishi-dsh-suite`

`nishi-dsh-claude-code` is **retired** and does not exist at `0.1.0-rc.2`. It is not a rename in the npm sense — the old name stays published at `0.1.0-rc.1` and is deprecated (see below), and a new name enters the family. `scripts/verify-release-family.mjs` asserts that the retired name (`nishi-dsh-claude-code`, alongside other historically retired boundaries) appears nowhere in any manifest at this version.

`pnpm verify:local` was confirmed passing end to end against this roster, and `node scripts/verify-release-family.mjs` reports:

```text
release-family-ok 9 packages @ 0.1.0-rc.2
```

## Runtime model — no bundled vendor runtimes

None of the nine packages bundle a vendor agent SDK or CLI. `@openai/codex*` and `@anthropic-ai/*` are absent from the entire lock graph; `scripts/verify-release-family.mjs` enforces this by rejecting any dependency section (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) across the family that names one of:

- `@openai/codex`
- `@openai/codex-sdk`
- `@anthropic-ai/claude-agent-sdk`
- `@anthropic-ai/sdk`

Codex, Claude, and Antigravity are invoked as **already-installed external CLIs** on the host, discovered through explicit environment overrides first, then `PATH`:

- Codex: `DSH_CODEX_EXECUTABLE`, else `codex` on `PATH`.
- Claude: `DSH_CLAUDE_EXECUTABLE`, else `claude` on `PATH`.
- Antigravity: no `DSH_*_EXECUTABLE` override exists. The executable is a plugin config field
  (`executable`, defaulting to `agy`) resolved through the DSH subprocess service. The
  `DSH_ANTIGRAVITY_CLI_EXECUTABLE` and `DSH_ANTIGRAVITY_SUBAGENT_CLI_EXECUTABLE` names that appear in
  the source are internal Windows batch-shim plumbing, not user-facing overrides.

If the configured/PATH executable is missing or fails the runtime handshake, only that provider's integration becomes unavailable with a stable diagnostic; the rest of the suite remains usable. Full design: `docs/superpowers/specs/2026-08-27-vendor-cli-runtime-design.md`.

## CLI versions this RC was accepted against

- `claude` `2.1.246`
- `codex-cli` `0.150.0`
- `agy` `1.1.21`
- Node.js `24.19.0` (fnm-managed; the system `/usr/bin/node` is v22 and must not be used)
- pnpm `11.21.0`
- Platform: CachyOS/Linux

Compatibility with Codex is established by executable discovery plus the existing App Server `initialize -> initialized` handshake, not by an exact version-string equality gate. The versions above are the CachyOS live-acceptance baseline for this RC, not a hard minimum-version requirement enforced in code.

## Historical hard gates

From a clean Node.js 24 / pnpm 11.21.0 checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:local
pnpm check:npm-names
```

`pnpm verify:local` runs release-family verification, package-contract verification, Orchestrator validation, TypeScript checks, package tests, builds, and local tarball creation. As of this RC, the local gate builds packages before running checks (`fix(release): build before check in verify:local`, `2ed92ea`).

Windows is deliberately deferred for `0.1.0-rc.2`, same as `0.1.0-rc.1`. Do not describe this RC as Windows-validated or cross-platform validated.

GitHub Actions remain blocked before execution by an account billing lock (`BLOCKED_BILLING`). This RC relies on the recorded local Node 24 acceptance and must not claim a hosted-CI PASS.

## Live acceptance required before publication

Per Stage 0.4 of `docs/ROADMAP.md`, live acceptance for this RC covers:

- Codex primary + routed `web_search` + memory read/write;
- Antigravity primary + mid-conversation model switch + `agy search_web`;
- three usage rows render;
- Claude row degrades explicitly when the `claude` CLI is absent.

TODO: record the actual acceptance evidence file/path here once that pass is executed and captured, the same way `docs/acceptance/2026-08-27-registry-smoke.md` was linked from the rc.1 runbook.

## Publication order — leaves-first under `next`

Publication follows the exact order in `scripts/pack-local.mjs`'s `packageOrder`, leaves first so that every package's family dependencies are already resolvable on the registry when it is published:

1. `nishi-dsh-project-memory`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude-usage-source`
5. `nishi-dsh-usage-limits`
6. `nishi-dsh-codex-usage-source`
7. `nishi-dsh-primary-web-search`
8. `nishi-dsh-usage-limits-host`
9. `nishi-dsh-suite`

All nine publish under the `next` dist-tag at exactly `0.1.0-rc.2`, then registry resolution is verified at exact versions — same discipline as rc.1's Stage 0.6 gate. This step waits for explicit maintainer approval before any `npm publish` runs; nothing in this document authorizes running it.

## Postpublication step — deprecate the retired name

After all nine packages resolve on the registry:

```bash
npm deprecate nishi-dsh-claude-code@0.1.0-rc.1 "Replaced by nishi-dsh-claude-usage-source. Claude is no longer an agent provider in this suite; nishi-dsh-claude-code is retired."
```

This points anyone still depending on the old package at its usage-only successor without unpublishing or rewriting rc.1 history.

## npm bootstrap `latest` behavior — carried over from rc.1

The first public verification of `nishi-dsh-suite` at `0.1.0-rc.1` reported `latest -> 0.1.0-rc.1`, and authenticated attempts to remove `latest` from the newly created package names were rejected by the registry with `E400 Bad Request`. That state is unrelated to `0.1.0-rc.2` package identities — `nishi-dsh-claude-usage-source` is a first-publication name at rc.2, so the same first-version `latest` bootstrap bind is expected to recur for it specifically, independent of the other eight names' existing `latest` state.

Project policy, unchanged from rc.1: `latest` pointing at any prerelease train is recorded as unavoidable first-version/bootstrap registry state, never as a stable-release declaration by this project. Do not retry `npm dist-tag rm ... latest` and do not unpublish a version merely to change that state.

## Known limitations

- **GitHub Actions are blocked by billing** (`BLOCKED_BILLING`). No hosted-CI PASS is claimed for this RC; all gates above are local.
- **Windows is NOT TESTED.** This RC does not claim Windows or cross-platform validation.
- **The `latest` dist-tag stuck to rc.1 on first publication and is expected to stick again for the new `nishi-dsh-claude-usage-source` name.** This is registry bootstrap behavior, not a stable-release claim, and is not being fought — see above.
- **No regression net against vendor CLI protocol drift** (tracked as Risk R1 in `docs/ROADMAP.md`): no test in `pnpm test` spawns a real `claude`/`codex`/`agy`. A vendor CLI patch release can break the product silently between acceptance and use.

## Real web profile upgrade

Per Stage 0.8 of `docs/ROADMAP.md`, `~/.dsh/profiles/web` is upgraded from rc.1 to rc.2 in place:

- upgrade the profile's Nishi DSH Suite dependency from `0.1.0-rc.1` to `0.1.0-rc.2`;
- **preserve the existing `dsh-chatgpt-web` link** — it must not be dropped, recreated, or re-pointed as a side effect of the upgrade;
- run `preset update`;
- confirm nothing unrelated to the Suite upgrade and the preserved link was touched in the profile.

TODO: record the actual upgrade transcript/evidence here once this step is executed, including before/after `preset status` output and confirmation that `dsh-chatgpt-web` survived unchanged.

## Future version-to-version gate

Same caveat as rc.1: a real version-to-version registry/profile update is only meaningfully exercised once a second intentional Nishi prerelease exists after this one. This runbook's rc.1 -> rc.2 upgrade (both on the registry and for the real web profile above) is that gate for rc.2 itself; do not treat a future rc.3 as required to validate rc.2's own publication.

## Rollback

Do not unpublish a version merely because an acceptance issue is found after release. Prefer fixing forward with the next prerelease. If this RC is found unsafe to install, change the prerelease channel or document the affected version according to npm policy rather than rewriting publication history.

## Known limitation: Antigravity delegated subagent cannot use tools

`subagent_antigravity` can only answer prompts that need no tools. The Antigravity
CLI cannot prompt for tool permission in headless mode and auto-denies instead, so
any delegated task that reads a file, greps, or runs a command ends the turn as
CANCELED. Verified live against `agy 1.1.21`; a prompt needing no tools completes
normally, and the same prompt with a file read does not. The workspace being listed
in the CLI's trusted workspaces makes no difference.

The Suite does not pass `--dangerously-skip-permissions`, because the managed agent
definition's tool list is not honoured by the CLI -- its session announces the full
native toolset -- so skipping permissions would hand a delegated run the browser,
shell, and native subagent tools rather than the seven the definition names.

Operators who want Antigravity delegation must allow the tools in the Antigravity
CLI's own permission settings. The failure now reports
`category: permission-denied` and names the denied tool instead of surfacing as a
bare abort.

Codex delegation is unaffected, and Antigravity remains fully functional as a
primary provider: catalog, turns, tool loop, project memory, session reopen, model
switch, and web search all pass live.
