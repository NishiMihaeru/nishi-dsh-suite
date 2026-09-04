# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / FOUNDATION & CODEX THAWED PENDING RE-VALIDATION**

The local gate is green — `pnpm verify:local` exits `0` on every run since a load-sensitive Project Memory recovery read race was fixed. Codex and Antigravity live acceptance are no longer missing: both were re-run in full on 2026-08-31 against this tree, together with a first cross-route delegation run, which found a Codex defect on a mid-turn route switch, since fixed (`ROADMAP.md` §2). Four further live suites were added on 2026-08-31 and passed: the Antigravity MCP tool bridge -- since removed with its transport, `ROADMAP.md` §3 -- the vendor's enforcement of an agent tool allowlist, and for Codex that `thread/inject_items` reaches the model at all, alongside the existing tool-result continuation probe.

A whole-tree adversarial review by two models that did not write the code then reported **16 defects on this green tree**, all now closed: 15 fixed, one rejected on the upstream subprocess contract, one referred to the maintainer and decided. Two were in code written the same day, one of them a local-socket exposure. Method and findings: `verification/gemini/LATEST.md`.

Foundation and Codex remain thawed all the same, and that review is the argument for it rather than against: a green gate plus vendor live suites is not an acceptance. Independent validation by a party that did not write the code -- those reviewers' charters and the reading of their findings both came from the author -- plus a repeated alpha.1 runtime probe, are still missing. See `HANDOFF.md`.

Current development baseline:

- Node `24.19.0` accepted Foundation baseline;
- pnpm `11.21.0`;
- workspace devDependency graph: DSH `0.1.2-rc.1`, resolved from npm;
- provider package peers: DSH `0.1.2-rc.1`; the executable evidence each provider moved on was gathered on the alpha.1 baseline and has not been repeated on rc.1;
- Linux/CachyOS development environment;
- Windows: **NOT TESTED**.

Only supported DSH generation:

```text
dsh-v0.1.2-rc.1
```

`0.1.2-alpha.1` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence. `docs/README.md` owns that policy.

Every package publishes exactly:

```text
0.1.2-rc.1
```

Those ranges install from npm: upstream published `0.1.2-rc.1`, which removed the release gate alpha.1 imposed — alpha.1 was never published, so every declared range was uninstallable while it was the baseline.

The rc.1 claim rests on the full workspace suite building, typechecking and unit-testing green against registry rc.1 (`pnpm verify:local` exit `0`, 592 tests). It does **not** rest on any live vendor suite or product-level profile run: the alpha.1-era live records in `verification/README.md` describe a different baseline and are not evidence for this tree. Re-running them is a release gate, not a formality.

## rc.3 family

Exactly seven packages move together at `0.1.0-rc.3`:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-grok`
6. `nishi-dsh-project-memory`
7. `nishi-dsh-suite`

All seven are `private`. `nishi-dsh-*` is not installed from npm. The previously published `0.1.0-rc.1` family is withdrawn; rc.2 was never published. rc.3 is the git `main` line and installs from a checkout via `pnpm pack:local` and `scripts/install-local-profile.mjs`. The only registry dependency is DeepSeek Harness (`@deepseek-ai/dsh-*` `0.1.2-rc.1`).

## Foundation state — THAWED, PENDING RE-VALIDATION

The independent alpha.1 Foundation audit/remediation cycle was accepted at the checkpoint below. A later audit of Core, Project Memory and Codex then reproduced defects in all three and changed behavior in each, so that acceptance no longer describes this tree and cannot gate a release. See `HANDOFF.md`.

Superseded accepted implementation HEAD:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw follow-up PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

The report commit modifies only `docs/verification/gemini/LATEST.md`.

Accepted Foundation evidence includes:

- Core focused tests `182/182`, check/build PASS;
- Project Memory focused tests `64/64`, check/build PASS;
- full workspace test/check/build PASS;
- `pnpm verify:local` PASS;
- 20/20 repeated runs of the previously failing PM concurrency/recovery suites;
- zero unexpected lock/WAL residue in exercised success/recovery paths;
- bidirectional `@deepseek-ai/dsh-atomic-write` lock interoperability;
- disposable exact-commit alpha.1 runtime probes for Project Memory tools/recovery/cancellation and Core Connection/auth/usage seams;
- independent follow-up code review with no new blocking Foundation defect;
- GitHub Actions/hosted CI not used;
- Windows NOT TESTED.

Durable details live in `docs/verification/README.md`.

Historical Foundation PASS checkpoints remain evidence only for their historical implementation trees and are superseded for current status by the accepted checkpoint above.

## Main rc.3 product direction

The Suite has one provider-independent Core plus one plugin per provider. Project Memory remains separate/provider-agnostic.

Vendor-specific delegation tools are removed. Orchestrator uses DSH-native `subagent` / `subagent_fork` on the active primary route.

Provider routes preserved for compatibility:

```text
codex-app-server
antigravity-cli
```

Claude is usage-only and has no Nishi model route/search backend.

The old `ctx.projectMemory` delegated service boundary is gone. Memory is exposed through ordinary DSH `memory_read`, `memory_write`, `memory_edit` plus `/memory` and `/consolidate` maintenance commands.

## Deployment prerequisite introduced in rc.3

`antigravity-cli` needs no vendor setup beyond a working `agy` login: it has one tool transport, the forced output schema, and the `transport` config key is gone. The `mcp-bridge` transport that briefly required a once-per-machine server registration and an `mcp(<server>/*)` grant was removed on 2026-09-03 (`ROADMAP.md` §3), so any install or Market description written against that requirement is stale.

## Open release work

Foundation is no longer blocking provider work. Remaining order:

1. freeze Codex after provider-specific cleanup/compatibility/live acceptance;
2. freeze Antigravity after cleanup/catalog/compatibility/live acceptance;
3. freeze Claude after usage-only cleanup/compatibility/smoke;
4. recheck repository-wide provider invariants and dependency declarations;
5. run cross-provider product acceptance;
6. run final profile install/update/remove lifecycle;
7. run managed Orchestrator preset lifecycle;
8. run final deterministic/local/vendor/bundle/name release gates.

Product live acceptance must still cover Codex primary/search/vendor-memory suppression, Antigravity primary/model switch/search, Codex -> Antigravity switch in one session, Project Memory continuity, and live Usage & Limits dynamic-roster cases.

## Final release commands

Run after the last implementation/dependency change:

```bash
pnpm install --frozen-lockfile
pnpm verify:local
pnpm smoke:vendor-cli
# local tarball install into a disposable profile; does not use the npm registry for nishi-dsh-*
# pnpm verify:bundle-install --profile <name> --suite <suite.tgz> --local-pack-dir .artifacts/packs --dsh-home <home>
```

Read real exit codes; do not mask failures through pipelines.

## Security/runtime release boundary

Release must continue to satisfy:

- no vendor credential/session/token store copied, parsed, migrated or deleted;
- no unsafe read-check-delete legacy credential mutation;
- no `@openai/codex*` or `@anthropic-ai/*` runtime dependency in the Suite graph unless separately reviewed;
- vendor sign-in stays inside official vendor products;
- no silent provider fallback for routed search;
- Project Memory path/symlink confinement remains fail-closed;
- the removed Antigravity MCP bridge must not be reintroduced; no Suite-owned MCP server registration belongs in the user's vendor configuration;
- no Windows support claim before Windows acceptance.

## Orchestrator preset distribution

Until separately changed by compatibility work, the supported rc.3 path remains the explicit managed bridge:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Use `preset update` after a Suite update and `preset remove` before Suite removal. Do not describe this as automatic one-click preset discovery.

## Market submission

Prepared registry template:

```text
docs/market/awesome-dsh-plugin-entry.yml
```

It may advertise only behavior proven by the final released build.

Current Market gates:

- [x] repository PR #1 merged historically;
- [x] repository has sufficient commit history;
- [ ] Core + Project Memory Foundation re-validation after the follow-up audit remediation;
- [ ] Codex re-validated and frozen after the follow-up audit remediation;
- [ ] Antigravity frozen;
- [ ] Claude frozen;
- [ ] repository topic `dsh-plugin` added;
- [x] nishi-dsh-* is not an npm install; previously published `0.1.0-rc.1` is withdrawn; only DeepSeek Harness comes from the registry;
- [ ] final deterministic/local/live release gates PASS;
- [ ] final local-tarball install/update/uninstall acceptance PASS;
- [ ] Windows acceptance if a Windows compatibility claim is desired;
- [ ] Market description rechecked against the exact released install path.

## Publication authorization

**No rc.3 publication approval has been given.**

Do not publish packages, merge the rc.3 feature branch, create a tag/release, or deprecate npm packages merely because technical gates pass. Request explicit maintainer approval after all required gates are complete.
