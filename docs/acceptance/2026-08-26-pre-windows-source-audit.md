# Pre-Windows source and profile-semantics audit — 2026-08-26

Status: **PASS — no product-runtime code change required**

This audit closes two deferred release-readiness questions before the independent Windows acceptance:

1. whether the repository should force pnpm `autoInstallPeers: false` because DSH profiles use that setting;
2. whether the migrated Project Memory `bootstrap.ts` / `commands.ts` lost accepted behavior when their source was condensed during the Market migration.

## Baselines

Accepted private migration source:

- repository: `NishiMihaeru/dsh-plugin`
- commit: `6f04b4f140a0f04f0011317565ca6b674f61deb3`

DSH runtime baseline:

- DeepSeek Harness `0.1.1-rc.2`
- upstream source commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Public branch audited:

- repository: `NishiMihaeru/nishi-dsh-suite`
- branch: `feat/market-migration`
- audit started after CachyOS live-runtime acceptance completed.

## 1. pnpm peer-install semantics

The public repository lockfile currently records pnpm's development-workspace setting:

```yaml
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
```

The accepted private development workspace also did **not** set `autoInstallPeers: false`; its `pnpm-workspace.yaml` only selected `packages/*` and allowed the esbuild build.

DSH profile runtime is intentionally different. In DSH `0.1.1-rc.2`, `packages/boot/app-boot/src/profile.ts` creates every profile workspace with:

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```

The upstream comment explains the reason: out-of-tree plugins must share DSH's installation-owned Cordis/DSH service graph through the healed `profiles/node_modules` fallback rather than getting independently auto-installed peer copies.

### Decision

**Do not force `autoInstallPeers: false` on the Nishi development monorepo merely to make its root lockfile resemble a DSH profile.** They are separate installation contexts, and the accepted private workspace did not impose that setting either.

Release correctness is established at the actual consumer boundary instead:

- fresh packed Suite acceptance has already run inside a real disposable DSH profile;
- the accepted Codex release-graph audit found no nested old DSH graph after the final vendored-adapter fix;
- `scripts/verify-bundle-install.mjs` now explicitly checks the real profile `pnpm-workspace.yaml` after install/reinstall/uninstall and fails unless it contains both `nodeLinker: hoisted` and `autoInstallPeers: false`.

This prevents future DSH/profile changes from silently invalidating the peer-sharing assumption while leaving development-workspace behavior independent.

## 2. Project Memory exactness review

The two deferred files are textually different between the accepted private source and the public migration:

| File | Accepted private blob | Public pre-audit blob |
| --- | --- | --- |
| `packages/project-memory/src/bootstrap.ts` | `59d3a1daa58283c568ec636c4a71759f8775beae` | `d517302dedeb3e66cc1fc41e746c9e9d1a4d4114` |
| `packages/project-memory/src/commands.ts` | `d54855461189054d2ddbfdc25f0a93e5bad00e8a` | `d755909db1ed66429ce274c9efe0e6414c561332` |

The public versions were condensed: JSDoc/comments and multi-line control flow were shortened. The audit therefore compared behavior function-by-function rather than treating blob inequality as a product regression.

### `bootstrap.ts`

Confirmed equivalent accepted behavior for:

- `MAX_BOOTSTRAP_LINES = 200` and `MAX_BOOTSTRAP_BYTES = 25 * 1024`;
- initial `MEMORY.md` content;
- line-bound truncation;
- valid UTF-8 byte truncation;
- combined line/byte bootstrap bounds;
- strict write/edit bound rejection before mutation;
- canonical `.dsh/memory/MEMORY.md` paths;
- symlink/non-regular fail-closed behavior;
- exclusive first creation and idempotent existing-file handling;
- atomic bootstrap replacement/edit;
- exact-single-match edit semantics;
- Memory map heading ambiguity rejection;
- canonical topic-entry replacement/deduplication;
- placeholder replacement and insertion ordering;
- topic identifier validation;
- serialized per-project Memory map mutation via the normalized-root mutex.

One representative textual condensation is behaviorally identical: the accepted source reads `MEMORY.md` in separate `if (!exists) ... else ...` branches, while the public source performs the conditional bootstrap creation and then one shared read.

The previously discovered migration defect (missing `writeFile` import) had already been corrected before this audit and is present in the public source.

### `commands.ts`

Confirmed equivalent accepted behavior for:

- the full Project Memory maintenance directive and durable-knowledge allow/deny categories;
- the consolidation directive and its prohibition on secrets, quota, raw chain-of-thought, transient logs, and shell deletion as a memory-delete substitute;
- `<provider>/<model>` validation and first-slash split;
- provider discovery and model resolution;
- safe error categories without leaking raw provider errors;
- cancellation handling;
- maintenance message creation with stable message identity;
- model selection starting inactive;
- activation only after authoritative downstream `enter` contains the exact maintenance message;
- cleanup on a later turn, agent error, turn stopping, steer failure, or idle fallback;
- per-agent prevention of overlapping maintenance commands;
- `/memory` and `/consolidate` registration, usage errors, success/error responses, and optional commands-service injection.

The private source contains explanatory comments (including an old comment referring to an earlier rc.6 API naming); the public source removes those comments without changing runtime behavior.

### Decision

**No formatting-only restoration was made.** Restoring thousands of lines solely to reproduce comments/line breaks would create a large review diff after the same behavior has already passed deterministic tests and live Project Memory provider acceptance on CachyOS.

The accepted behavioral contract is preserved, and the private blob hashes above remain the provenance anchors for future audits.

## Result

- DSH profile peer-install semantics: **PASS**, now asserted at the actual runtime-profile boundary.
- Project Memory accepted behavior: **PASS**, no semantic loss found in `bootstrap.ts` or `commands.ts`.
- Product/runtime source changes required: **none**.
- Windows acceptance may proceed.

This audit does not replace the still-pending independent Windows runtime acceptance, real version-to-version Suite update gate, GitHub Actions billing blocker, or upstream DSH rc.2 preset-discovery issue #2.
