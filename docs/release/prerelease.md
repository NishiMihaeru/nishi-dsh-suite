# Nishi DSH Suite prerelease runbook

Target release train: `0.1.0-rc.1`.

Status: **PUBLISHED / REGISTRY SMOKE PASS / MARKET PENDING**.

Release scope for this RC: **CachyOS/Linux validated; Windows not tested and not claimed**.

## Completed first-publication gates

The accepted source was merged to public `main` before npm publication.

Accepted merge commit:

```text
aff2cab95ea2816b5aff002e51562a15aeeb8dba
```

Immediately before publication:

- clean Node 24 / pnpm 11.21.0 local gate: PASS;
- `pnpm verify:local`: PASS;
- npm package-name probe: `all-unscoped-names-available 9`;
- npm operator authentication: `npm whoami` -> `nishimihaeru`.

All nine packages are visible from the public npm registry at exactly `0.1.0-rc.1`:

1. `nishi-dsh-codex`
2. `nishi-dsh-antigravity`
3. `nishi-dsh-claude-code`
4. `nishi-dsh-project-memory`
5. `nishi-dsh-usage-limits`
6. `nishi-dsh-codex-usage-source`
7. `nishi-dsh-primary-web-search`
8. `nishi-dsh-usage-limits-host`
9. `nishi-dsh-suite`

The documented prerelease install channel is `next`; exact-version installs are also supported.

## npm bootstrap `latest` behavior

The first public verification of `nishi-dsh-suite` reported:

```text
{ next: '0.1.0-rc.1', latest: '0.1.0-rc.1' }
```

Authenticated attempts to remove `latest` from the newly created packages completed npm's normal browser-auth flow but the public registry rejected each DELETE with `E400 Bad Request`.

This is recorded as npm registry first-version/bootstrap state, not as a stable-release declaration by this project. Do not keep retrying `npm dist-tag rm ... latest` and do not unpublish the version merely to change that state.

Project policy for `0.1.0-rc.1`:

- `next` is the documented prerelease channel;
- exact-version installs are supported;
- `latest -> 0.1.0-rc.1` is recorded as unavoidable first-version registry state;
- no stable-release claim is made from that tag;
- a future stable release may intentionally take ownership of `latest`.

## Registry-only smoke — PASS

A fresh disposable DSH `0.1.1-rc.2` home/profile installed only:

```bash
dsh plugin --profile nishi-registry-smoke add nishi-dsh-suite@0.1.0-rc.1
```

No local tarball paths or local pnpm overrides were used.

Executed result:

- Suite resolved from the public npm tarball: PASS;
- all eight Nishi leaf packages resolved at exactly `0.1.0-rc.1`: PASS;
- `@deepseek-ai/dsh-authorization` and `@deepseek-ai/dsh-sdk-protocol` were `0.1.1-rc.2`: PASS;
- managed Codex packages were `0.147.0`: PASS;
- Claude Agent SDK was `0.3.220`: PASS;
- no old nested `@deepseek-ai/*@0.1.0-rc.*` graph appeared in the captured profile listing: PASS;
- `preset install`: PASS;
- `preset status`: `current`;
- `preset remove`: PASS / status `absent`;
- normal DSH Suite removal completed without a DSH error: PASS;
- real `~/.dsh` was not used.

Detailed evidence: `docs/acceptance/2026-08-27-registry-smoke.md`.

During preset reconciliation/removal, pnpm attempted downloads for several optional Codex/Claude platform artifacts that do not match the host architecture and emitted retry warnings before completing successfully. This is currently a non-blocking dependency-resolution/download UX observation, not a registry-smoke failure.

## Historical hard gates

From a clean Node.js 24 / pnpm 11.21.0 checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:local
pnpm check:npm-names
```

`pnpm verify:local` runs release-family verification, package-contract verification, Orchestrator validation, TypeScript checks, package tests, builds, and local tarball creation.

The CachyOS acceptance remains the runtime baseline for fresh-profile lifecycle, managed preset safety, Codex/Claude/Antigravity live providers, routed search, Project Memory aggregate preservation, Usage & Limits runtime/UI, missing-client isolation, and uninstall/preservation.

Windows is deliberately deferred for `0.1.0-rc.1`. Do not describe this RC as Windows-validated or cross-platform validated.

GitHub Actions are currently blocked before execution by an account billing lock. This RC relies on the recorded local Node 24 acceptance and must not claim a hosted-CI PASS.

## Future version-to-version gate

A real version-to-version update cannot be exercised until a second intentional Nishi prerelease exists. Same-version reinstall is accepted but is not equivalent to an update.

Do not invent or rename the current Nishi package version solely to manufacture this gate. When the next prerelease is intentionally created, test registry/profile update from `0.1.0-rc.1` to that version and run `preset update`.

This future update gate does not block the already-published first `0.1.0-rc.1`; it blocks claiming version-to-version update acceptance.

## Market submission gate

The Market app consumes the curated `awesome-dsh-plugin/awesome-dsh-plugin` registry. Current submission rules require:

- a real `dsh.bundle` manifest;
- repository age of at least 1 day;
- at least 10 commits;
- repository topic `dsh-plugin`;
- an accurate, non-marketing description.

This repository was created at `2026-08-26T00:15:47Z`, so the age gate becomes eligible after `2026-08-27T00:15:47Z`.

The npm publication and registry-only smoke gates are complete. Remaining Market preparation:

1. add GitHub repository topic `dsh-plugin`;
2. verify the repo is older than one day at submission time;
3. submit one monorepo entry pointing to `https://github.com/NishiMihaeru/nishi-dsh-suite/tree/main/packages/suite`;
4. keep the description factual and state the actual prerelease/platform scope.

Automatic packaged-preset discovery remains blocked upstream on DSH `0.1.1-rc.2` (issue #2); the explicit managed preset bridge is the accepted workaround and must not be described as one-click native preset discovery.

## Rollback

Do not unpublish a version merely because an acceptance issue is found after release. Prefer fixing forward with the next prerelease. If the RC is unsafe to install, change the prerelease channel or document the affected version according to npm policy rather than rewriting publication history.