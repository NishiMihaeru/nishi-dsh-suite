# Nishi DSH Suite prerelease runbook

Target release train: `0.1.0-rc.1`.

Status: **PREPARED / NOT PUBLISHED**.

## Hard gates before publishing

From a clean Node.js 24 / pnpm 11.21.0 checkout:

```bash
corepack enable
pnpm install
pnpm verify:package-contracts
pnpm verify:release-family
pnpm check:npm-names
pnpm check
pnpm test
pnpm build
pnpm test:orchestrator
node scripts/pack-local.mjs
```

Then inspect every packed manifest and confirm:

- package version is exactly `0.1.0-rc.1`;
- no packed dependency contains a `workspace:` protocol;
- `nishi-dsh-suite` contains `cordis.patch.yml` and `dsh.bundle.patch` points to it;
- `nishi-dsh-suite` contains prebuilt `lib/bin.js` and declares `bin.nishi-dsh-suite = ./lib/bin.js`;
- `nishi-dsh-suite` contains `presets/orchestrator/preset.yml` and `presets/orchestrator/agent.cordis.yml`;
- `nishi-dsh-usage-limits-host` contains both `lib/index.js` and `lib/client.js` plus package notices;
- no private source paths, credentials, session data, `.env`, or local DSH state are present.

Do not publish if any deterministic gate is red.

## Package-name rule

Run `pnpm check:npm-names` immediately before first publication.

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

Use a prerelease dist-tag such as `next`; do **not** publish this RC under `latest`.

Example after all gates pass and npm authentication is intentionally configured:

```bash
pnpm --filter nishi-dsh-codex publish --tag next --no-git-checks
# ...continue in the order above...
pnpm --filter nishi-dsh-suite publish --tag next --no-git-checks
```

The commands above are operator steps, not automated repository actions.

## Post-publish smoke

In a fresh ordinary DSH `0.1.1-rc.2` Web profile, install only the Market-facing package:

```bash
dsh plugin --profile web add nishi-dsh-suite@0.1.0-rc.1
```

Confirm the profile manifest contains `nishi-dsh-suite` once in `dsh.profile.bundles`.

Because DSH rc.2 cannot discover the packaged third-party preset root automatically, install the explicit managed Orchestrator bridge from the exact package already installed in the profile:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Require `absent → current`, verify the Orchestrator appears in DSH, then execute the full Windows/CachyOS acceptance matrix.

For a subsequent prerelease update, Market/plugin update is followed by:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset update
```

Before uninstalling the Suite on rc.2, remove the managed user preset while the package binary is still available:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset remove
dsh plugin --profile web remove nishi-dsh-suite
```

Verify sibling presets, sessions, project files, Project Memory, DSH credentials, and vendor-owned auth state are unchanged.

## Rollback

Do not unpublish a version merely because an acceptance issue is found after release. Prefer fixing forward with the next prerelease version and leave `latest` untouched. If the RC is unsafe to install, remove or change the prerelease dist-tag according to npm policy and document the affected version in the GitHub prerelease notes.
