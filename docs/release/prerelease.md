# Nishi DSH Suite prerelease runbook

Target release train: `0.1.0-rc.1`.

Status: **PREPARED / NOT PUBLISHED**.

Release scope for this RC: **CachyOS/Linux validated; Windows not tested and not claimed**.

## Hard gates before publishing

From a clean Node.js 24 / pnpm 11.21.0 checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:local
pnpm check:npm-names
```

`pnpm verify:local` runs:

- release-family verification;
- package-contract verification;
- Orchestrator validation;
- TypeScript checks;
- package tests;
- builds;
- local tarball creation.

The current CachyOS acceptance must remain green for:

- fresh normal DSH `0.1.1-rc.2` profile composition;
- prepublish install/reinstall/uninstall with the unchanged Suite tarball and acceptance-only local leaf resolution;
- managed Orchestrator preset bridge and safety checks;
- Codex primary/subagent/native search;
- Claude Code subagent;
- Antigravity primary/subagent/`agy` search;
- Project Memory aggregate read-only visibility and hash preservation;
- Usage & Limits runtime/UI;
- uninstall/preservation and missing-client isolation.

Windows is deliberately deferred for `0.1.0-rc.1`. Do not describe this RC as Windows-validated or cross-platform validated.

Then inspect every packed manifest and confirm:

- package version is exactly `0.1.0-rc.1`;
- no packed dependency contains a `workspace:` protocol;
- `nishi-dsh-suite` contains `cordis.patch.yml`, its prebuilt `lib/bin.js`, and packaged Orchestrator YAML;
- `dsh.bundle.patch` points to `./cordis.patch.yml`;
- `nishi-dsh-usage-limits-host` contains both `lib/index.js` and `lib/client.js` plus package notices;
- no private source paths, credentials, session data, `.env`, or local DSH state are present.

Do not publish if any deterministic or accepted CachyOS gate is red.

GitHub Actions are currently blocked before execution by an account billing lock. This RC relies on the recorded local Node 24 acceptance and must not claim a hosted-CI PASS.

## Package-name rule

Run `pnpm check:npm-names` **immediately before first publication**. Search-engine absence is not sufficient evidence of availability.

If **any** unscoped name is already owned by another publisher, stop and rename the **entire** package family to one scope before publishing anything:

```text
@nishimihaeru/dsh-codex
@nishimihaeru/dsh-antigravity
@nishimihaeru/dsh-claude-code
@nishimihaeru/dsh-primary-web-search
@nishimihaeru/dsh-project-memory
@nishimihaeru/dsh-usage-limits
@nishimihaeru/dsh-usage-limits-host
@nishimihaeru/dsh-codex-usage-source
@nishimihaeru/dsh-suite
```

Never publish a mixed scoped/unscoped family.

## Publish order

Publish leaves before packages that depend on them:

1. `nishi-dsh-codex`
2. `nishi-dsh-antigravity`
3. `nishi-dsh-claude-code`
4. `nishi-dsh-project-memory`
5. `nishi-dsh-usage-limits`
6. `nishi-dsh-codex-usage-source`
7. `nishi-dsh-primary-web-search`
8. `nishi-dsh-usage-limits-host`
9. `nishi-dsh-suite`

Use the prerelease dist-tag `next`; do **not** publish this RC under `latest`.

After npm authentication is intentionally configured by the operator:

```bash
pnpm --filter nishi-dsh-codex publish --tag next --no-git-checks
pnpm --filter nishi-dsh-antigravity publish --tag next --no-git-checks
pnpm --filter nishi-dsh-claude-code publish --tag next --no-git-checks
pnpm --filter nishi-dsh-project-memory publish --tag next --no-git-checks
pnpm --filter nishi-dsh-usage-limits publish --tag next --no-git-checks
pnpm --filter nishi-dsh-codex-usage-source publish --tag next --no-git-checks
pnpm --filter nishi-dsh-primary-web-search publish --tag next --no-git-checks
pnpm --filter nishi-dsh-usage-limits-host publish --tag next --no-git-checks
pnpm --filter nishi-dsh-suite publish --tag next --no-git-checks
```

These are explicit operator steps; the repository does not publish from lifecycle hooks or hidden automation.

## Post-publish registry smoke

After all nine packages are visible under `next`, create a fresh disposable ordinary DSH `0.1.1-rc.2` profile and install **only** the Market-facing registry package:

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

A real version-to-version update cannot be exercised until a second Nishi prerelease version exists. Same-version reinstall is already accepted but is not equivalent to an update.

Do not invent or rename the current Nishi package version solely to manufacture this gate. When the next prerelease is intentionally created, test registry/profile update from `0.1.0-rc.1` to that version and run `preset update`.

This future update gate does not block publishing the first `0.1.0-rc.1` prerelease; it blocks claiming that version-to-version update behavior has been accepted.

## Market submission gate

The Market app consumes the curated `awesome-dsh-plugin/awesome-dsh-plugin` registry. Its current submission rules require:

- a real `dsh.bundle` manifest;
- repository age of at least 1 day;
- at least 10 commits;
- repository topic `dsh-plugin`;
- an accurate, non-marketing description.

This repository was created at `2026-08-26T00:15:47Z`, so the age gate becomes eligible after `2026-08-27T00:15:47Z`. Do not submit the Market PR before that time.

Before Market submission:

1. publish and complete the registry smoke above;
2. add the GitHub repository topic `dsh-plugin`;
3. verify the repo is older than one day at submission time;
4. submit one monorepo entry pointing to `https://github.com/NishiMihaeru/nishi-dsh-suite/tree/main/packages/suite` after the release branch has been merged to `main`;
5. keep the description factual and state the actual prerelease/platform scope.

Automatic packaged-preset discovery remains blocked upstream on DSH `0.1.1-rc.2` (issue #2); the explicit managed preset bridge is the accepted workaround and must not be described as one-click native preset discovery.

## Rollback

Do not unpublish a version merely because an acceptance issue is found after release. Prefer fixing forward with the next prerelease version and leave `latest` untouched. If the RC is unsafe to install, remove or change the prerelease dist-tag according to npm policy and document the affected version in the GitHub prerelease notes.
