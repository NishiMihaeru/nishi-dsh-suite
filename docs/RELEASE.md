# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / FOUNDATION & CODEX THAWED PENDING RE-VALIDATION**

The local gate is green — `pnpm verify:local` exits `0` on every run since a load-sensitive Project Memory recovery read race was fixed. Codex and Antigravity live acceptance are no longer missing: both were re-run in full on 2026-08-31 against this tree, together with a first cross-route delegation run, which found a Codex defect on a mid-turn route switch, since fixed (`ROADMAP.md` §2). Four further live suites were added on 2026-08-31 and pass: the Antigravity MCP tool bridge, the vendor's enforcement of an agent tool allowlist, and for Codex that `thread/inject_items` reaches the model at all, alongside the existing tool-result continuation probe.

A whole-tree adversarial review by two models that did not write the code then reported **16 defects on this green tree**, all now closed: 15 fixed, one rejected on the upstream subprocess contract, one referred to the maintainer and decided. Two were in code written the same day, one of them a local-socket exposure. Method and findings: `verification/gemini/LATEST.md`.

Foundation and Codex remain thawed all the same, and that review is the argument for it rather than against: a green gate plus vendor live suites is not an acceptance. Independent validation by a party that did not write the code -- those reviewers' charters and the reading of their findings both came from the author -- plus a repeated alpha.1 runtime probe, are still missing. See `HANDOFF.md`.

Current development baseline:

- Node `24.19.0` accepted Foundation baseline;
- pnpm `11.21.0`;
- Foundation devDependency graph: DSH `0.1.2-alpha.1`, resolved from the local upstream checkout (see *Local setup* in `docs/README.md`);
- provider package peers: DSH `0.1.2-alpha.1`, each moved on its own executable evidence rather than by inheriting the Foundation's;
- Linux/CachyOS development environment;
- Windows: **NOT TESTED**.

Only supported DSH generation:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

`0.1.1-rc.2` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence. `docs/README.md` owns that policy.

Every package publishes exactly:

```text
0.1.2-alpha.1
```

Those ranges cannot be installed from npm today, because upstream has not published alpha.1 — `0.1.1-rc.2` is the newest published DSH. This is a deliberate release-gate condition, not an oversight: **publication is blocked until upstream publishes `0.1.2-alpha.1`.** Until then the declared range is honest about what the code was built and tested against, which matters more than installability for a family with no consumers yet.

alpha.1 support for the Foundation rests on the disposable exact-commit probe against the official alpha.1 checkout/runtime, not on rc.2 workspace tests.

## rc.3 family

Exactly six packages move together at `0.1.0-rc.3`:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

`0.1.0-rc.1` remains the published npm family. rc.2 was deliberately left unpublished.

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

`antigravity-cli` defaults to the `mcp-bridge` tool transport, which needs the bridge server registered once per machine in the user's own `agy` configuration, plus a narrow `mcp(<server>/*)` grant. Until both are in place the route's first turn fails, naming the exact command and the resolved path; it deliberately does not fall back, because a route that silently hands the model no tools looks healthy. `transport: "schema"` selects the previous forced-schema path and needs no setup. This must be stated in any install or Market description.

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
pnpm verify:bundle-install
pnpm check:npm-names
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
- the Antigravity MCP bridge's socket directory stays private to the invoking user: ownership and mode are verified rather than assumed, because `mkdir` with a mode does not correct a directory that already exists, and a world-writable one would expose every tool catalog the bridge hands out;
- the bridge server's global registration in the user's own vendor configuration is an accepted exposure, narrowed by the parent-pid claim: a server no live adapter claims is served an empty catalog. It is never written by this suite;
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
- [ ] rc.3 family published consistently to npm;
- [ ] final deterministic/local/live release gates PASS;
- [ ] final install/update/uninstall acceptance PASS;
- [ ] Windows acceptance if a Windows compatibility claim is desired;
- [ ] Market description rechecked against the exact released install path.

## Publication authorization

**No rc.3 publication approval has been given.**

Do not publish packages, merge the rc.3 feature branch, create a tag/release, or deprecate npm packages merely because technical gates pass. Request explicit maintainer approval after all required gates are complete.
