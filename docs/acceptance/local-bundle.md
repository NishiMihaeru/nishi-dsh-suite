# Local bundle acceptance — DSH 0.1.1-rc.2

Status: **HARNESS_READY / NOT_YET_EXECUTED**

This gate exercises the ordinary DSH profile plugin path. It does not create a portable DSH home, copy sessions between machines, or rewrite vendor authentication stores.

## Prerequisites

- Node.js 24
- pnpm 11.21.0
- ordinary DeepSeek Harness `0.1.1-rc.2` installation
- the target DSH profile must not already have `nishi-dsh-suite` installed
- workspace dependencies installed and `pnpm-lock.yaml` regenerated/validated before treating a frozen install as a release gate

## 1. Build local tarballs

```bash
pnpm pack:local
```

The script builds the eight leaf packages plus `nishi-dsh-suite` into:

```text
.artifacts/packs/
```

Expected Suite tarball for the first prerelease:

```text
.artifacts/packs/nishi-dsh-suite-0.1.0-rc.1.tgz
```

Packing must confirm pnpm rewrites source `workspace:0.1.0-rc.1` specs to exact distributable versions and that the Suite tarball contains `lib/bin.js` plus `presets/orchestrator/{preset.yml,agent.cordis.yml}`.

## 2. Install / reconcile on a normal profile

Run the verifier against an explicitly chosen ordinary profile, for example `web`:

```bash
node scripts/verify-bundle-install.mjs \
  --profile web \
  --suite .artifacts/packs/nishi-dsh-suite-0.1.0-rc.1.tgz
```

If the real DSH home is known, pass it only so the verifier can inspect the profile manifest; this does **not** change or replace `DSH_HOME`:

```bash
node scripts/verify-bundle-install.mjs \
  --profile web \
  --dsh-home /path/to/actual/dsh-home \
  --suite .artifacts/packs/nishi-dsh-suite-0.1.0-rc.1.tgz
```

With profile manifest inspection enabled, the verifier requires:

- `nishi-dsh-suite` is a direct profile dependency after install;
- `nishi-dsh-suite` occurs exactly once in `dsh.profile.bundles`;
- reinstall/update does not duplicate the bundle layer.

## 3. Install the rc.2 Orchestrator bridge

After the bundle is installed, execute the package binary through that same profile:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Require `absent → current` on a fresh DSH home. A second install must be idempotent.

The bridge may write only:

```text
$DSH_HOME/.agent-presets/orchestrator/
```

An unmanaged existing directory must be refused. A local edit to a managed preset must produce `modified` status and block both update and remove.

## 4. Preservation checks

`--preserve` may be repeated. Each supplied file/directory is SHA-256 snapshotted recursively before the operation and must stay byte-for-byte unchanged after install, update/reinstall, and uninstall.

Recommended acceptance targets, using the actual paths for the machine being tested:

```bash
node scripts/verify-bundle-install.mjs \
  --profile web \
  --dsh-home /actual/dsh/home \
  --suite .artifacts/packs/nishi-dsh-suite-0.1.0-rc.1.tgz \
  --preserve /actual/dsh/home/sessions \
  --preserve /project/DSH.md \
  --preserve /project/.dsh/memory \
  --preserve /path/to/vendor-owned/config-or-auth-state
```

The verifier does not need to understand the contents of those paths and does not modify them. Hashing is local acceptance instrumentation only.

## 5. Real version-to-version update

Reinstalling the same tarball exercises idempotent profile reconciliation. A true update requires a second prerelease build:

```bash
node scripts/verify-bundle-install.mjs \
  --profile web \
  --dsh-home /actual/dsh/home \
  --suite /path/to/nishi-dsh-suite-0.1.0-rc.1.tgz \
  --update-spec /path/to/nishi-dsh-suite-0.1.0-rc.2.tgz
```

After the package update, run:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset update
dsh plugin --profile web exec nishi-dsh-suite preset status
```

When the package version/content changed, require `outdated → current`. Do not mark the update gate passed until two different package versions have been exercised.

## 6. Remove preset before bundle uninstall

DSH rc.2 has no supported bundle-uninstall hook for the user preset directory, so the explicit managed preset must be removed while the package binary is still installed:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset remove
dsh plugin --profile web remove nishi-dsh-suite
```

Require:

- managed `orchestrator` is absent;
- sibling user presets remain;
- Suite dependency and bundle layer are removed;
- preserved sessions, project files, Project Memory, DSH credentials, and vendor-owned paths are unchanged.

## Automatic-discovery limitation

The explicit bridge is the accepted temporary rc.2 path. Automatic one-click discovery of the packaged Orchestrator remains blocked by the DSH third-party preset-root override documented in `docs/acceptance/orchestrator.md` and issue #2.

## Current result

The acceptance harness and preset lifecycle implementation exist, but none of the executable commands above have been claimed as passing in this migration branch yet. GitHub-hosted CI is externally blocked by the account billing lock, so a local run or restored runner is required for executable evidence.
