# Latest Gemini validation

Validation: documentation consolidation
Tested commit: 7c0857f478ce40ad6fa162b3820c9ca461fa69cf
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Documentation inventory

Executed `find docs -type f | sort`:

```text
docs/ARCHITECTURE.md
docs/HANDOFF.md
docs/market/awesome-dsh-plugin-entry.yml
docs/README.md
docs/RELEASE.md
docs/ROADMAP.md
docs/verification/gemini/LATEST.md
docs/verification/README.md
```

Inventory verification:
- Canonical development documents present: `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/HANDOFF.md`, `docs/RELEASE.md`.
- Durable validation ledger present: `docs/verification/README.md`.
- Rolling Gemini validation target present: `docs/verification/gemini/LATEST.md`.
- Market submission template present: `docs/market/awesome-dsh-plugin-entry.yml`.
- All legacy directories (`docs/superpowers/`, `docs/acceptance/`, `docs/release/`) and dated reports/plans have been deleted from `docs/`.

## Source-of-truth model

Audited responsibility boundaries across root and documentation files:
- `README.md`: User/product overview, runtime package breakdown (`0.1.0-rc.3`), managed preset bridge commands, canonical read order.
- `docs/README.md`: Documentation index, read sequence for developers, ownership matrix, agent rules (in-place updates, no dated reports/plans).
- `docs/ARCHITECTURE.md`: Technical contract only (package boundaries, Core lifecycle, ProviderDescriptor, registration transaction, Project Memory contract, invariants). No session logs or roadmap items.
- `docs/ROADMAP.md`: Status ledger only (Core & Project Memory DONE/FROZEN, sequential provider stages 1-7, deferred items). No architecture re-specifications.
- `docs/HANDOFF.md`: Operational handoff (branch, next task: Codex, agent-to-Gemini validation workflow, traps, hard constraints). No historical narrative.
- `docs/RELEASE.md`: Release state (IN REPOSITORY / UNPUBLISHED / PROVIDER-LIVE ACCEPTANCE OPEN), 6-package family at `0.1.0-rc.3`, gates, publication authorization boundary.
- `docs/verification/README.md`: Compact durable validation ledger (Core 01–14, PM01–02, open validation gates, git history recovery instructions).
- `docs/verification/gemini/LATEST.md`: Single rolling raw report destination for Gemini validation runs.

## Stale-reference audit

1. Ripgrep pattern for legacy docs/reports:
   `rg -n "docs/superpowers|docs/acceptance|docs/release/|SESSION-SUMMARY|core-[0-9]{2}-|project-memory-0[12]" README.md docs packages scripts package.json`
   - `docs/verification/README.md:112, 114`: Valid git history recovery examples (`git log -- docs/acceptance`, `git show <commit>:docs/acceptance/...`).
   - `packages/suite/README.md:112`: Stale reference to deleted `docs/release/2026-08-28-rc3-prerelease.md`.
   - `docs/market/awesome-dsh-plugin-entry.yml:1`: Stale reference to deleted `docs/release/market-submission.md`.
   - `packages/core/src/runtime/registration.ts:12`: Stale reference to deleted `docs/superpowers/specs/provider-bridge-design.md`.
   - `packages/core/src/runtime/index.ts:5`: Stale reference to deleted `docs/superpowers/specs/provider-bridge-design.md`.

2. Ripgrep pattern for doc creation prompts:
   `rg -ni "create.*plan|new.*plan|create.*summary|session summary|new.*report|docs/verification/gemini/.*\.md|acceptance.*\.md" README.md docs packages`
   - Verified that agents are strictly instructed NOT to create new plans/summaries/reports and to update canonical docs in place.

3. Markdown link / path audit:
   `rg -n "docs/" README.md docs packages`
   - All internal links in `README.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/HANDOFF.md`, `docs/RELEASE.md`, `docs/verification/README.md` resolve to existing canonical files.
   - Identified 4 stale/broken references in `packages/suite/README.md`, `docs/market/awesome-dsh-plugin-entry.yml`, and `packages/core/src/runtime/` comments.

## Architecture consistency

Verified code implementation against `docs/ARCHITECTURE.md`:
- Core Lifecycle: Outer `nishi-core` has `inject: []`, mounts `NishiProvidersService`, then mounts inner `nishi-core-host` with `inject: ['nishiProviders', 'connection', 'credentials']`. Core has no direct injection of or dependency on `dsh-authorization`.
- Provider Descriptor: `ProviderDescriptor` defines `id`, `presentation`, `executable`, optional `model`, `webSearch`, `usage`, `install`. Model routes reside under `descriptor.model.routes`.
- Registration: Provider plugins invoke `registerProvider(ctx, descriptor, config)` rather than mutating internal registry state directly.
- Providers:
  - Codex (`packages/codex`): id `codex`, route `codex-app-server`, model: yes, search: yes, usage: yes, history install: yes, subagent: no.
  - Antigravity (`packages/antigravity`): id `antigravity`, route `antigravity-cli`, model: yes, search: yes, usage: yes, subagent: no.
  - Claude (`packages/claude`): id `claude`, model: no, routes: none, search: no, usage: yes, subagent: no.
- Project Memory (`packages/project-memory`): Single project root policy (nearest `.git` directory or file, explicit cwd fallback); replacement writes use `@deepseek-ai/dsh-atomic-write`; `/memory` and `/consolidate` require `commands` and `llm` services; tools `memory_read`, `memory_write`, `memory_edit`; no `ctx.projectMemory` service; no `memory_delete`.
- Core Neutrality: `packages/core/package.json` and `packages/core/src` contain zero dependencies on provider packages (`nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`). Model accounts IDs (`openai-codex`, `anthropic`, `openai`) are foreign credential IDs.

## Status consistency

- `docs/ROADMAP.md` and `docs/HANDOFF.md` consistently report:
  - Core: DONE / FROZEN
  - Project Memory: DONE / FROZEN
  - Active next task: Codex provider cleanup and acceptance.
  - Downstream sequence: Codex -> Antigravity -> Claude -> Provider invariants -> Cross-provider live acceptance -> Install/profile lifecycle -> Release gate.
- Release family: Exactly 6 packages (`nishi-dsh-core`, `nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`, `nishi-dsh-project-memory`, `nishi-dsh-suite`) at version `0.1.0-rc.3`.
- Delegation terminology: Retired vendor-specific subagents (`subagent_codex`, `subagent_antigravity`, `subagent_claude_code`) only appear in notices, comments, or regression tests explaining their removal. Orchestrator uses DSH-native `subagent` / `subagent_fork`.

## Git-history recovery

Probed git history for deleted documents:
- `git log --oneline -- docs/verification/gemini | head -20` (exit code: 0)
- `git log --oneline -- docs/acceptance | head -20` (exit code: 0)
- `git log --oneline -- docs/superpowers | head -20` (exit code: 0)
- `git show 49d2c68ea052d6be2fcd972898b79d368c2896f9:docs/verification/gemini/core-14-final-acceptance.md` (exit code: 0)
- `git show 49d2c68ea052d6be2fcd972898b79d368c2896f9:docs/verification/gemini/project-memory-02-final-acceptance.md` (exit code: 0)

All historical reports and acceptance files are fully recoverable through Git history.

## Repository gate

Executed `pnpm verify:local`:
- Node: `v24.19.0`
- pnpm: `11.21.0`
- Result: PASS (exit code: 0)
- Verified all workspace typechecks, unit tests, tsdown builds, and 6 tarball packaging artifacts (`.artifacts/packs/*.tgz`).

## Findings

The documentation consolidation successfully established the single-source-of-truth structure, verified against code and verified by a clean local repository gate.

However, 4 stale references to deleted files remain in the current tree:
1. `packages/suite/README.md:112`:
   `See docs/HANDOFF.md, docs/ROADMAP.md, and docs/release/2026-08-28-rc3-prerelease.md for current status.`
   -> `docs/release/2026-08-28-rc3-prerelease.md` does not exist; should reference `docs/RELEASE.md`.
2. `docs/market/awesome-dsh-plugin-entry.yml:1`:
   `# FUTURE SUBMISSION TEMPLATE — do not submit while docs/release/market-submission.md has open gates.`
   -> `docs/release/market-submission.md` does not exist; should reference `docs/RELEASE.md`.
3. `packages/core/src/runtime/index.ts:5`:
   `* shape. See docs/superpowers/specs/provider-bridge-design.md ("The kit")`
   -> `docs/superpowers/specs/provider-bridge-design.md` does not exist; should reference `docs/ARCHITECTURE.md`.
4. `packages/core/src/runtime/registration.ts:12`:
   `* See docs/superpowers/specs/provider-bridge-design.md for the design this`
   -> `docs/superpowers/specs/provider-bridge-design.md` does not exist; should reference `docs/ARCHITECTURE.md`.

## Working tree

Clean before report modification (`git status --short` was empty).

## Verdict

FAIL

Reason: 4 stale references to deleted files (`docs/release/2026-08-28-rc3-prerelease.md`, `docs/release/market-submission.md`, `docs/superpowers/specs/provider-bridge-design.md`) found in `packages/suite/README.md`, `docs/market/awesome-dsh-plugin-entry.yml`, and `packages/core/src/runtime/`.
