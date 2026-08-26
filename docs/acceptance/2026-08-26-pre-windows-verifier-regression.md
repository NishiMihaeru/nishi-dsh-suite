# Pre-Windows bundle verifier regression — 2026-08-26

Status: **PASS**

Operator environment:

- Node `v24.19.0`
- pnpm `11.21.0`
- DSH `0.1.1-rc.2`
- tested branch head `d7ca6e5cd5bd986223170e8d722ab93ebf01597c`

## Background

The first hardened-verifier run proved the DSH profile pnpm contract but stopped before Suite lifecycle completion because the exact prerelease Nishi leaf packages were not yet published. Installing the unchanged Suite tarball therefore caused pnpm to resolve leaf versions such as `nishi-dsh-codex@0.1.0-rc.1` from the public registry and fail with `ERR_PNPM_FETCH_404`.

That result was classified as a **prepublish acceptance-harness limitation, not a product release-graph regression**.

The verifier was then extended with explicit `--local-pack-dir` support. The mode keeps the real Suite tarball unchanged and temporarily maps only the eight Nishi leaf names to their local `.tgz` artifacts in the disposable DSH profile workspace. `--dsh-home` also now sets child `DSH_HOME` directly so isolation does not depend on a separate shell export.

## Executed prepublish rerun

`pnpm verify:local`: **PASS**.

Local artifact family:

- nine tarballs present: **PASS**
- one unchanged `nishi-dsh-suite-0.1.0-rc.1.tgz`: **PASS**
- eight Nishi leaf tarballs available for acceptance-only local resolution: **PASS**

DSH profile contract:

- `nodeLinker: hoisted`: **PASS**
- `autoInstallPeers: false`: **PASS**

Temporary prepublish overrides:

- installed only in the disposable DSH profile: **PASS**
- Suite tarball itself remained unchanged: **PASS**
- original DSH-generated `pnpm-workspace.yaml` restored after uninstall: **PASS**
- no final `overrides:` section remained: **PASS**

Bundle lifecycle:

- install: **PASS**
- idempotent reinstall/reconciliation: **PASS**
- uninstall: **PASS**

Final disposable profile:

- `nishi-dsh-suite` dependency absent: **PASS**
- `nishi-dsh-suite` absent from `dsh.profile.bundles`: **PASS**

Preservation:

- real `~/.dsh` touched: **no**
- repository status after execution: **clean**

## Result

The prepublish standalone-profile bundle verifier is **PASS** at head `d7ca6e5cd5bd986223170e8d722ab93ebf01597c`.

This establishes that the real packed Suite can be installed, reconciled, and removed through a normal disposable DSH `0.1.1-rc.2` profile before public npm publication while preserving the actual publish-time package metadata. Local tarball overrides are acceptance scaffolding only and are fully removed from the profile afterward.

This does not replace the later post-publication registry install acceptance or the still-pending real version-to-version RC update test.
