# Release state

Current target: `0.1.0-rc.3`

Status: **IN REPOSITORY / UNPUBLISHED / FOUNDATION & CODEX THAWED PENDING RE-VALIDATION**

Current development baseline:

- Node `24.19.0` accepted Foundation baseline;
- pnpm `11.21.0`;
- local package devDependency graph: DSH `0.1.1-rc.2`;
- Linux/CachyOS development environment;
- Windows: **NOT TESTED**.

Accepted authoritative Foundation compatibility target:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Core and Project Memory publish:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The main workspace graph remains rc.2, so alpha.1 support is accepted because the changed Foundation was separately exercised against the exact official alpha.1 checkout/runtime.

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
