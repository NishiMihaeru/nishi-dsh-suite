# Nishi DSH Suite prerelease runbook

Target release train: `0.1.0-rc.1`.

Status: **PUBLISHED / REGISTRY SMOKE PENDING**.

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

All nine packages are now visible from the public npm registry at exactly `0.1.0-rc.1`:

1. `nishi-dsh-codex`
2. `nishi-dsh-antigravity`
3. `nishi-dsh-claude-code`
4. `nishi-dsh-project-memory`
5. `nishi-dsh-usage-limits`
6. `nishi-dsh-codex-usage-source`
7. `nishi-dsh-primary-web-search`
8. `nishi-dsh-usage-limits-host`
9. `nishi-dsh-suite`

The intended prerelease install channel is `next`.

## npm bootstrap `latest` behavior

The first public verification of `nishi-dsh-suite` reported:

```text
{ next: '0.1.0-rc.1', latest: '0.1.0-rc.1' }
```

Attempts to remove `latest` from the newly created packages completed npm's normal browser authentication flow but the public registry rejected each DELETE with `E400 Bad Request`.

This is treated as npm registry bootstrap behavior for a newly created package whose first published version is a prerelease, not as a stable-channel declaration by this project. Do not keep retrying `npm dist-tag rm ... latest` and do not unpublish the version.

Project policy for `0.1.0-rc.1`:

- `next` is the documented prerelease channel;
- exact-version installs are also supported;
- `latest -> 0.1.0-rc.1` is recorded as unavoidable first-version registry state;
- no stable-release claim is made from that tag;
- a future stable release may intentionally take ownership of `latest`.

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

## Package-name rule

The fresh first-publication check passed for all nine unscoped names. The approved scoped fallback was therefore not used.

Never mix scoped and unscoped package families in a future train.

## Publish order

The first RC was published leaves-first and Suite-last. Future prereleases should retain dependency order and publish with an explicit prerelease dist-tag.

## Post-publish registry smoke

Create a fresh disposable ordinary DSH `0.1.1-rc.2` profile and install **only** the Market-facing registry package by exact prerelease version:

```bash
dsh plugin --profile nishi-registry-smoke add nishi-dsh-suite@0.1.0-rc.1
```

No local overrides or local tarball paths are allowed in this smoke.

Then:

```bash
dsh plugin --profile nishi-registry-smoke exec nishi-dsh-suite preset install
dsh plugin --profile nishi-registry-smoke exec nishi-dsh-suite preset status
```

Confirm:

- registry resolution installs all eight leaf packages at exactly `0.1.0-rc.1`;
- no nested old `@deepseek-ai/*@0.1.0-rc.*` graph appears;
- `nishi-dsh-suite` appears once in `dsh.profile.bundles`;
- preset status becomes `current`;
- DSH starts and the Suite composes normally;
- remove the preset before uninstalling the Suite;
- uninstall leaves unrelated state untouched.

This registry smoke is required before Market submission.

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

This repository was created at `2026-08-26T00:15:47Z`, so the age gate becomes eligible after `2026-08-27T00:15:47Z`. Do not submit the Market PR before that time.

Before Market submission:

1. complete the registry smoke above;
2. add GitHub repository topic `dsh-plugin`;
3. verify the repo is older than one day at submission time;
4. submit one monorepo entry pointing to `https://github.com/NishiMihaeru/nishi-dsh-suite/tree/main/packages/suite`;
5. keep the description factual and state the actual prerelease/platform scope.

Automatic packaged-preset discovery remains blocked upstream on DSH `0.1.1-rc.2` (issue #2); the explicit managed preset bridge is the accepted workaround and must not be described as one-click native preset discovery.

## Rollback

Do not unpublish a version merely because an acceptance issue is found after release. Prefer fixing forward with the next prerelease. If the RC is unsafe to install, remove/change the prerelease dist-tag according to npm policy and document the affected version.
