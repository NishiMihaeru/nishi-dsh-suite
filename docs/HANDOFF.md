# Handoff

Updated for `0.1.0-rc.3` after Core and Project Memory final acceptance.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

Core and Project Memory are **DONE / FROZEN**. The next active stage is **Codex provider cleanup and acceptance**.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. `packages/codex/README.md`, then the exact source/tests being changed

Do not reconstruct current work from old commits or deleted historical docs unless a specific regression requires archaeology.

## Next task: Codex

Scope provider-local work first. Do not reopen Core or Project Memory without a reproducible blocker.

Target outcomes:

- inspect remaining Codex-local failure classes/string builders and migrate only behavior that belongs to the shared core `VendorFailure` contract;
- inspect duplicate generic helpers and reuse core helpers only where the contract is actually provider-neutral;
- preserve Codex-specific protocol translation in the Codex package;
- focused Codex tests/check/build;
- then live primary/search/vendor-memory-suppression acceptance;
- freeze Codex before moving to Antigravity.

Important provider boundary:

- canonical provider id: `codex`;
- model route: `codex-app-server`;
- model: yes;
- native search backend: yes;
- usage/rate limits: yes;
- primary-history bridge: yes;
- vendor-specific subagent: no.

## Frozen invariants

Do not accidentally regress these while working on providers:

- providers register through the shared `registerProvider()` path;
- Core has no provider-package dependency;
- outer `nishi-core` has no external injection and publishes `NishiProvidersService` before the inner host child;
- inner host child injects `nishiProviders`, `connection`, `credentials`;
- Core does not depend on `dsh-authorization`;
- web search routes by the exact current request-header route and never silently falls back;
- capability absence is legal;
- Project Memory context/tools use one root policy;
- Project Memory replacement writes remain atomic and path-confined;
- vendor-specific delegation tools stay removed.

See `ARCHITECTURE.md` for the full contract. Do not duplicate architecture text here.

## Development workflow

The assistant edits GitHub; Gemini validates on the maintainer's local machine where the real Node/DSH/vendor environment exists.

For each narrow issue:

1. Assistant fetches the current target file and SHA from `feat/core-provider-plugins-rc3`.
2. Assistant edits source/tests/docs directly on the branch.
3. Assistant provides one complete Gemini validation prompt.
4. Gemini uses:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini validates but does not repair implementation unless explicitly allowed.
6. Gemini **overwrites only**:

   ```text
   docs/verification/gemini/LATEST.md
   ```

   Do not create a new report file per issue.
7. Gemini commits/pushes `LATEST.md` even on FAIL.
8. Maintainer replies only `готово`.
9. Assistant reads `LATEST.md` from GitHub and either patches the blocker or closes the issue and continues.
10. After PASS, assistant folds durable validation status into `docs/verification/README.md`, updates this handoff/roadmap only if status changed, then reuses `LATEST.md` for the next validation.

This keeps one raw report and one compact validation ledger instead of an ever-growing report archive. Exact older reports remain recoverable from git history.

## Validation baseline

- Node `v24.19.0` through fnm.
- pnpm `11.21.0`.
- DSH `0.1.1-rc.2`.
- `/usr/bin/node` may be v22; do not use it for acceptance.

Typical focused provider gates:

```bash
pnpm --filter <package> test
pnpm --filter <package> check
pnpm --filter <package> build
```

Run broader gates only when the scope justifies them. Final release gates are owned by `RELEASE.md`.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the Suite runtime lock graph.
- Windows remains **NOT TESTED**.
- No publish / merge / tag / release without explicit maintainer approval.
- Live provider tests consume real subscription quota; group them deliberately.

## Operational traps

- Cordis service access is injection-protected; type casts do not bypass the runtime proxy.
- Provider registrations arrive after Core publishes the registry, so provider rosters must remain dynamic.
- If Core types are intentionally changed after reopening, rebuild Core before trusting provider typecheck results that may read built declarations.
- DSH `0.1.1-rc.2` overwrites contributed third-party preset roots; the managed Suite preset bridge is still required.
- Vendor CLI drift is caught by vendor smoke/live tests, not ordinary unit tests.
- Read command exit codes directly; avoid pipelines that mask the failing command.

## After Codex

The fixed order is:

1. Codex
2. Antigravity
3. Claude
4. repository-wide provider invariants
5. cross-provider/product live acceptance
6. install/profile lifecycle
7. release gate

`ROADMAP.md` owns details and completion status for that sequence.
