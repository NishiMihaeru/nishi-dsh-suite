# Workflow, roadmap, and release state

Canonical sources:
- `docs/README.md` — documentation map/change discipline.
- `docs/HANDOFF.md` — immediate operational state and hard constraints.
- `docs/ROADMAP.md` — ordered work/status.
- `docs/RELEASE.md` — release and Market gates.
- `docs/prior-art.md` — external design survey and adopted lessons.

## Reading and ownership
1. Read `docs/README.md`, then `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and the target package README/source/tests.
2. Read `docs/RELEASE.md` for packaging, live acceptance, Market, or publication work.
3. Read `docs/verification/README.md` and the relevant vendor contract for exact evidence.
4. Canonical docs are updated in place. Do not create dated plans, handoffs, session summaries, or Gemini reports. Git history owns superseded detail.
5. Historical PASS/live evidence validates only the exact implementation and DSH/vendor baseline it tested.

## Current project state
- Development branch recorded by the handoff: `feat/core-provider-plugins-rc3`; family `0.1.0-rc.3`; seven packages; unpublished.
- Supported DSH: only official `0.1.2-rc.1`, resolved from npm. Alpha.1 and earlier are unsupported.
- Node contract is `>=24 <25`; accepted baseline recorded as Node `24.19.0`; pnpm `11.21.0`.
- Foundation (Core + Project Memory) and Codex are thawed pending independent re-validation.
- Antigravity is frozen on the documented 2026-09-04 evidence boundary. Later defect fixes/decomposition/quota work were re-run against recorded `agy` builds; future vendor self-updates require rerunning live suites.
- Claude remains usage-only and has not completed its provider stage.
- Grok is implemented with unit/live-primary evidence; product-level profile acceptance remains open.
- Local deterministic gates and provider live suites are useful but are not independent acceptance.

## Immediate priority/order
1. Independently revalidate and freeze Foundation and Codex on the current rc.1 tree.
2. Preserve Antigravity freeze boundaries; rerun its live suites after vendor self-updates rather than reopening the architecture by default.
3. Complete Grok product-profile acceptance and the remaining provider/release policy decisions documented in its contract.
4. Complete Claude usage-only audit, tests, official CLI usage smoke, and freeze; its possible primary route remains design-only.
5. Recheck repository-wide provider invariants, seven-package release-family metadata, and DSH dependency declarations.
6. Run product-level cross-provider acceptance: route switching, shared memory continuity, routed search attribution, model/effort selection, and dynamic Usage & Limits.
7. Validate profile install/update/remove and managed Orchestrator preset lifecycle; first determine whether the rc.1 host still requires the managed preset bridge.
8. Run final release gates and obtain explicit maintainer authorization before publish/merge/tag/release.

## Release gates
Run only after the final implementation/dependency change:
```bash
pnpm install --frozen-lockfile
pnpm verify:local
pnpm smoke:vendor-cli
# local tarball install into a disposable profile; does not fetch nishi-dsh-* from npm
# pnpm verify:bundle-install --profile <name> --suite <suite.tgz> --local-pack-dir .artifacts/packs --dsh-home <home>
```
Read every real exit code; do not hide failures in a pipeline. Live suites spend maintainer quota and require confirmation before bulk execution.

`nishi-dsh-*` is not installed from npm for now. All seven family packages are `private`. Supported install is `pnpm pack:local` plus `scripts/install-local-profile.mjs`. DSH itself (`@deepseek-ai/dsh-*`) still resolves from npm. Registry publication of rc.3 is deferred; `scripts/check-npm-names.mjs` is retained but is not a current gate.

## Known canonical-document drift to fix before release
- Historical ROADMAP/verification checkpoints still say "six packages" where they describe an older tree; do not rewrite those evidence lines.
- Treat `docs/ARCHITECTURE.md` plus the newest handoff entries and verification ledger as authoritative where older status paragraphs conflict.

## Hard constraints
- GitHub Actions/hosted CI are not used; do not inspect or edit `.github/workflows/*`.
- Never copy, parse, migrate, delete, or replay vendor credential/session/token stores. Vendor sign-in stays inside official vendor products.
- No silent cross-provider fallback for search.
- Windows remains NOT TESTED; do not claim support without acceptance.
- Core must not regain a credential-mutation/Model Accounts surface without a separately reviewed atomic-safe contract.
- No publish, merge, tag, release, package deprecation, or Market submission without explicit maintainer approval.

## Durable implementation lessons
- DSH history is authoritative. Any vendor conversation surviving multiple DSH steps must verify the exact delivered prefix and realign/rebuild when history changes.
- Prefer published structured vendor boundaries and measured behavior over TUI scraping, undocumented client impersonation, or inference from help text.
- Codex App Server protocol shape comes from the installed binary's schema/TypeScript generators; behavioral claims still need probes.
- Codex A/B probes must counterbalance process warm-up. `tokenUsage.last.totalTokens` is per-request context, not additive cost.
- A raw App Server probe without production isolation config does not describe product token cost.
- Antigravity's published `/usage` command supersedes all historical private loopback-RPC quota machinery.
- Grok isolation must keep the tested paired allow/deny tool flags; `--tools ""` is a silent no-op that fails open.
- A green deterministic gate is necessary but insufficient: adversarial review and live product runs have found defects after green unit/workspace runs.
- Product claims should be proven from durable route/session logs, observed vendor processes, and planted markers—not from the model's own narrative.