# Local bundle acceptance — DSH 0.1.1-rc.2

Status: **HARNESS_READY / NOT_YET_EXECUTED**

This gate exercises the ordinary DSH profile plugin path. It does not create a portable DSH home, copy sessions between machines, or rewrite vendor authentication stores.

## Prerequisites

- Node.js 24
- pnpm 11.21.0
- ordinary DeepSeek Harness `0.1.1-rc.2` installation
- the target DSH profile must not already have `nishi-dsh-suite` installed
- workspace dependencies installed and `pnpm-lock.yaml` regenerated/validated before treating a frozen install as a release gate

## 1. Build and verify local tarballs

```bash
corepack enable
pnpm install
pnpm verify:local
```

The one-shot gate runs repository/package contracts, Orchestrator validation, checks, tests, builds, and packs the eight leaf packages plus `nishi-dsh-suite` into:

```text
.artifacts/packs/
```

Expected Suite tarball for the first prerelease:

```text
.artifacts/packs/nishi-dsh-suite-0.1.0-rc.1.tgz
```

Packing must confirm pnpm rewrites source `workspace:0.1.0-rc.1` dependency specs to exact registry versions inside distributable manifests.

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

While Suite is installed in the profile:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

On a fresh user preset root the first status must be `absent`, then `current` after install. Successful install/update must leave no `.orchestrator.nishi-stage-*` or `.orchestrator.nishi-backup-*` siblings.

The bridge must refuse an unmanaged pre-existing `orchestrator`, and must refuse update/removal after a deliberate local edit.

## 4. Preservation checks

`--preserve` may be repeated. Each supplied file/directory is SHA-256 snapshotted recursively before lifecycle operations and must stay byte-for-byte unchanged.

Recommended acceptance targets:

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

A true update requires a second prerelease build. After changing the installed Suite version, check the managed preset before refreshing it:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset update
```

The old copy must report `outdated` and become `current` after update.

## 6. Uninstall lifecycle

DSH rc.2 has no bundle uninstall hook for the user preset directory. Remove the managed preset **before** removing the Suite package:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset remove
dsh plugin --profile web remove nishi-dsh-suite
```

Then verify:

- `nishi-dsh-suite` no longer appears as a dependency/bundle layer;
- `$DSH_HOME/.agent-presets/orchestrator` is absent only if it was still the unmodified managed copy;
- sibling user presets remain;
- all preserve hashes remain unchanged.

Automatic one-click preset discovery remains tracked as upstream issue #2; this explicit bridge is the rc.2 acceptance path.

## Current result

The acceptance harness and bridge code exist, but none of the executable commands above are claimed as passing yet. Current GitHub-hosted Actions fail before job steps start, so a local run or restored runner is required for evidence.
