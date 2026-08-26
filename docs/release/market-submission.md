# DSH Market submission

Status: **PREPARED / BLOCKED**

The in-app `dshmarket` catalog is sourced from the curated `awesome-dsh-plugin/awesome-dsh-plugin` registry. A plugin is not listed merely because it exists on npm.

The future registry entry is prepared at `docs/market/awesome-dsh-plugin-entry.yml`.

## Intended catalog identity

Because this repository is a monorepo and only the Suite package is the Market install target, the registry URL must point at the bundle subpackage:

```text
https://github.com/NishiMihaeru/nishi-dsh-suite/tree/main/packages/suite
```

The catalog's own npm probe then reads `packages/suite/package.json`, discovers `nishi-dsh-suite`, and accepts the mapping only if the npm package's `repository` metadata points back to `NishiMihaeru/nishi-dsh-suite`.

Do **not** add an `npm:` key to the registry YAML. The registry explicitly rejects unknown fields and resolves npm automatically.

## Hard gates before opening the registry PR

Every item below must be satisfied:

- [ ] PR #1 merged so the catalog URL exists on `main`.
- [ ] repository is at least one day old (awesome-dsh-plugin automated requirement).
- [x] repository has at least 10 commits.
- [ ] GitHub repository topic `dsh-plugin` added.
- [ ] `nishi-dsh-suite` and all required leaf packages published to npm under one consistent package family.
- [ ] npm package metadata points back to this repository.
- [ ] deterministic `pnpm check`, `pnpm test`, `pnpm build`, pack inspection all PASS on the accepted commit.
- [ ] fresh normal-profile install/update/uninstall acceptance PASS.
- [ ] Windows acceptance PASS.
- [ ] CachyOS acceptance PASS.
- [ ] issue #2 resolved with a supported DSH preset-discovery seam, **or** the catalog description is reduced to features that a one-click Market install actually exposes.

The last gate is release-critical for the currently prepared description. Today `presets/orchestrator` contains the fixed Codex/Claude Code/Antigravity delegation tools and routed `web_search`, but DSH `0.1.1-rc.2` does not automatically discover that third-party preset through normal bundle installation. Submitting the current full-feature description before that is resolved would overstate the one-click install.

## Proposed category

`model`

The Suite spans memory, usage and web capabilities, but its primary product boundary is model/provider integration: Codex and Antigravity primary providers plus provider-specific subagents. `awesome-dsh-plugin` maintainers may reclassify the entry; category is not treated as a rejection criterion.

## Registry PR procedure

After all hard gates pass:

1. Fork/clone `awesome-dsh-plugin/awesome-dsh-plugin`.
2. Copy the prepared YAML as:

   ```text
   data/plugins/NishiMihaeru__nishi-dsh-suite--packages-suite.yml
   ```

3. Run their required generator:

   ```bash
   npm ci
   node scripts/generate-readme.mjs
   ```

4. Verify the generated README changes only add the Nishi DSH Suite entry.
5. Open one PR against `awesome-dsh-plugin/awesome-dsh-plugin`.

Do not submit an entry to `dsh-market/dsh-market`; its own README states that the catalog is maintained in `awesome-dsh-plugin`.

## Description accuracy rule

The prepared English line is intentionally factual and contains no version/count marketing claims. Before submission, compare each claimed capability against the exact released Suite install path. Remove any capability that still requires manual repository copying, a custom installer, an unpublished package, or an undocumented DSH patch.
