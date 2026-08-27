# DSH Market submission

Status: **PREPARED / BLOCKED ON RC.3 RELEASE ACCEPTANCE AND REPOSITORY TOPIC**

The in-app `dshmarket` catalog is sourced from the curated `awesome-dsh-plugin/awesome-dsh-plugin` registry. A package is not listed merely because it exists on npm.

The future registry entry is prepared at:

```text
docs/market/awesome-dsh-plugin-entry.yml
```

## Intended catalog identity

This repository is a monorepo and only the Suite package is the Market install target, so the registry URL points at:

```text
https://github.com/NishiMihaeru/nishi-dsh-suite/tree/main/packages/suite
```

The catalog's npm probe reads `packages/suite/package.json`, discovers `nishi-dsh-suite`, and expects its repository metadata to point back to `NishiMihaeru/nishi-dsh-suite`.

Do **not** add an `npm:` key to the registry YAML unless the upstream registry schema changes; the prepared entry relies on the catalog's normal npm discovery.

## Current repository facts

Verified 2026-08-28:

- [x] PR #1 is merged to `main` (`aff2cab95ea2816b5aff002e51562a15aeeb8dba`).
- [x] Repository is older than one day (created `2026-08-26T00:15:47Z`).
- [x] Repository has more than 10 commits.
- [ ] GitHub repository topic `dsh-plugin` is **not present**; current topics list is empty.
- [x] Published rc.1 npm family exists.
- [ ] rc.3 family is not published.

The current development target is rc.3, so Market submission should not use the old rc.1 architecture description.

## Current rc.3 catalog description boundary

A normal Suite bundle install provides the host-plane composition:

- provider-independent Core;
- Codex primary provider;
- Antigravity primary provider;
- Claude usage-only provider;
- Project Memory;
- Usage & Limits / Model Accounts host/browser surfaces.

The packaged Orchestrator preset adds routed `web_search`, shared memory/tool rows and DSH-native `subagent` / `subagent_fork`, but DSH `0.1.1-rc.2` does not reliably preserve third-party contributed preset roots. The supported rc.3 workaround is the installed Suite's explicit managed preset bridge (`preset install/status/update/remove`).

Therefore Market copy must **not** imply that routed search or the Orchestrator preset appears automatically from one click unless the upstream preset-discovery limitation is fixed.

Vendor-specific Codex/Antigravity/Claude subagent tools no longer exist in rc.3 and must not appear in Market copy.

## Hard gates before opening the Market registry PR

- [x] PR #1 merged so the catalog URL exists on `main`.
- [x] Repository age >= 1 day.
- [x] Repository commit count >= 10.
- [ ] Add GitHub repository topic `dsh-plugin`.
- [ ] Finish rc.3 provider-specific cleanup and live product acceptance.
- [ ] Publish `nishi-dsh-suite` and all required rc.3 leaf packages under one consistent family, after explicit approval.
- [ ] Confirm published npm package metadata points back to this repository.
- [ ] Final deterministic rc.3 release gates PASS on the exact accepted commit.
- [ ] Fresh normal-profile install/update/uninstall acceptance PASS for the released rc.3 family.
- [ ] CachyOS/Linux final rc.3 live acceptance PASS.
- [ ] Decide Market policy for Windows: Windows remains NOT TESTED and no Windows claim may be made.
- [ ] Either upstream preset discovery is fixed, or the catalog description clearly distinguishes host-plane features from the optional explicitly installed Orchestrator preset.

## Proposed category

`model`

The primary product boundary is provider integration: Codex and Antigravity are selectable primary routes behind a shared Core contract; Claude contributes usage-only capability. The Suite also provides project memory and usage/browser surfaces.

There are no provider-specific subagent integrations in rc.3.

The `awesome-dsh-plugin` maintainers may reclassify the entry; category is not treated as a product invariant.

## Registry PR procedure

After all hard gates pass:

1. Fork/clone `awesome-dsh-plugin/awesome-dsh-plugin`.
2. Copy the prepared YAML as:

   ```text
   data/plugins/NishiMihaeru__nishi-dsh-suite--packages-suite.yml
   ```

3. Run the upstream repository's required generator/tests exactly as documented at submission time.
4. Verify generated changes only add/update the Nishi DSH Suite entry.
5. Open one PR against `awesome-dsh-plugin/awesome-dsh-plugin`.

Do not submit an entry to a different registry merely because a similarly named Market repository exists; re-check the current DSH Market submission documentation immediately before submission.

## Description accuracy rule

Before submission, compare every claimed capability against the exact published Suite install path.

Remove or qualify any feature that:

- requires an unpublished package;
- requires manual repository copying;
- requires an undocumented profile patch;
- requires explicit preset installation but is worded as automatic;
- names a retired vendor-specific subagent tool;
- has not passed the final rc.3 acceptance appropriate to that feature.

Current release status is tracked in `docs/release/2026-08-28-rc3-prerelease.md`.
