# Pre-Windows bundle verifier regression — 2026-08-26

Status: **HARNESS FIX PENDING LOCAL RE-RUN**

Operator environment:

- Node `v24.19.0`
- pnpm `11.21.0`
- DSH `0.1.1-rc.2`
- tested branch head `676b3d65648d849d9f9aa54020b7121846e8aadc`

## Observed result

`pnpm verify:local`: **PASS**.

The newly hardened profile contract assertions also passed:

- `nodeLinker: hoisted`: **PASS**
- `autoInstallPeers: false`: **PASS**
- real `~/.dsh` untouched: **PASS**
- repository status clean: **PASS**

The standalone `scripts/verify-bundle-install.mjs` lifecycle did not reach install/reinstall/uninstall because the Suite tarball contains the correct publish-time exact dependencies such as `nishi-dsh-codex@0.1.0-rc.1`, while those prerelease leaf packages are not yet published to npm. pnpm therefore attempted registry resolution and returned `ERR_PNPM_FETCH_404`.

This is a **prepublish acceptance-harness limitation, not a product release-graph regression**. The packed Suite must retain normal registry version dependencies; rewriting the published artifact to local paths would be incorrect.

## Harness correction

The verifier was updated after this report to support an explicit `--local-pack-dir` prepublish mode.

In that mode it:

1. initializes a normal disposable DSH profile;
2. verifies the DSH-owned profile contract (`nodeLinker: hoisted`, `autoInstallPeers: false`);
3. temporarily appends pnpm `overrides` mapping only the eight Nishi leaf package names to their local `.tgz` artifacts;
4. installs the **unchanged real Suite tarball** through `dsh plugin add`;
5. exercises idempotent reinstall and uninstall;
6. restores the original DSH-generated `pnpm-workspace.yaml` before final post-uninstall assertions.

The verifier also now makes `--dsh-home` set `DSH_HOME` for every child `dsh` process, removing the previous requirement for a separate shell `export DSH_HOME=...` and reducing the risk of accidentally touching the operator's real profile.

If initial add fails part-way through, cleanup now attempts Suite removal before restoring the acceptance-only workspace override.

## Required re-run

A fresh local execution is still required before this verifier hardening is marked PASS. Use the current `.artifacts/packs` directory:

```bash
TEST_DSH_HOME="$(mktemp -d -t nishi-profile-contract-XXXXXX)"

node scripts/verify-bundle-install.mjs \
  --profile pre-windows-contract \
  --suite "$PWD/.artifacts/packs/nishi-dsh-suite-0.1.0-rc.1.tgz" \
  --local-pack-dir "$PWD/.artifacts/packs" \
  --dsh-home "$TEST_DSH_HOME"
```

No separate `export DSH_HOME` should be necessary.

Expected result:

- install: PASS
- idempotent reinstall: PASS
- uninstall: PASS
- DSH profile pnpm contract: PASS throughout
- temporary local overrides restored after uninstall
- real `~/.dsh` untouched

This does not replace the later post-publication registry install acceptance or the still-pending real version-to-version RC update test.
