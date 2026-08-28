# Handoff

Updated for `0.1.0-rc.3` after the Core + Project Memory foundation re-freeze.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

Local validation baseline:

```text
Node: 24.19.0
pnpm: 11.21.0
DSH: 0.1.1-rc.2
OS: Linux/CachyOS
Windows: NOT TESTED
```

Official compatibility source target:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

For DSH compatibility questions, actual upstream source/runtime contracts at that exact tag/commit are primary truth. Documentation may lag implementation.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests

Use `docs/verification/README.md` only to confirm already accepted evidence. `docs/verification/gemini/LATEST.md` is the rolling raw Gemini report, not the durable project state.

## Foundation status — FROZEN

Core and Project Memory are re-frozen. Do not reopen or refactor them during provider work unless a new reproducible regression requires it.

Final foundation implementation HEAD:

```text
0c7a177d2f4fceab58513cbd0d87fcf9c31b025b
```

Final raw PASS report commit:

```text
c209be795601ac7c4a3328c4af6bdbefde7f9f82
```

Accepted final gates:

- `pnpm install --frozen-lockfile` PASS;
- Core `176/176` tests + check/build PASS;
- Project Memory `39/39` tests + check/build PASS;
- full workspace `270/270` tests + check/build PASS;
- `pnpm verify:local` PASS;
- six local rc.3 tarballs generated;
- packed Core/Project Memory metadata PASS;
- Core + Project Memory actual compatibility against installed DSH `0.1.1-rc.2` and official `0.1.2-alpha.1` PASS.

Core and Project Memory production DSH peers intentionally accept only:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Their local DSH dev graph remains pinned to `0.1.1-rc.2`. This does **not** imply that Codex, Antigravity, Claude or the complete Suite already support alpha.1; each provider has its own compatibility/freeze block.

## Immediate task — Codex cleanup and freeze

The next package is:

```text
packages/codex
```

Start from `packages/codex/README.md`, then inspect current source/tests and the actual upstream DSH contracts used by the package.

Current known Codex state:

- provider id `codex`;
- canonical model route `codex-app-server`;
- registration goes through Core `registerProvider()`;
- native Codex web search is contributed as a backend to `nishi-dsh-core/web-search`;
- vendor-specific delegation/subagent integration is removed;
- primary invocation disables vendor-native memories/project-doc injection with `memories.use_memories=false`, `memories.generate_memories=false`, `project_doc_max_bytes=0`;
- runtime uses the user's official `codex` executable; no `@openai/codex*` runtime package is bundled;
- existing repaired live primary fixture previously passed with `gpt-5.6-sol`.

Codex is **not frozen yet**. Its DSH package declarations are still rc.2-specific and must not be broadened merely because Core/Project Memory were broadened.

### Codex block goals

1. Audit current Codex production source against actual DSH `0.1.1-rc.2` and official `0.1.2-alpha.1` contracts used by the package.
2. Replace remaining provider-local failure/string-builder logic with the shared Core failure contract where it is genuinely provider-neutral.
3. Remove provider-local duplicates of provider-neutral helpers only where Core already owns the contract; do not move vendor protocol translation into Core.
4. Reconcile Codex DSH dependency/peer declarations only to versions actually proven by the provider-specific audit. Do not infer support from the foundation range.
5. Preserve the reviewed `wingoo/codex-plugin-dsh` snapshot boundary and its notice unless a separate upstream update is intentionally authorized.
6. Run focused `test` / `check` / `build`.
7. Run live primary acceptance.
8. Run routed native `web_search` acceptance.
9. Prove the primary invocation still suppresses vendor-native memory/project-doc injection.
10. Freeze Codex only after the focused/local/live block passes.

Do not start Antigravity until Codex is frozen.

## Invariants to preserve

- providers register only through shared `registerProvider()`;
- Core remains provider-independent and frozen;
- Project Memory remains provider-independent and frozen;
- model capability implies at least one canonical route;
- capability absence is legal;
- web search follows the exact current route with no vendor fallback;
- registry observers are non-vetoing;
- vendor-specific subagent registrations/tools remain absent;
- provider-native persistent memory/project-doc injection must not replace DSH Project Memory;
- no vendor credential/session/token stores are copied, parsed, migrated or deleted;
- `@openai/codex*` and `@anthropic-ai/*` remain absent from the Suite runtime lock graph unless a separately reviewed design explicitly changes that boundary.

## Development workflow

The assistant edits GitHub; Gemini validates on the maintainer's local machine.

For each narrow issue:

1. Fetch the current target file + SHA immediately before editing.
2. Make one logically complete change.
3. Provide one complete Gemini validation prompt.
4. Gemini uses:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini validates but does not repair implementation unless explicitly authorized.
6. Gemini overwrites only `docs/verification/gemini/LATEST.md`.
7. Gemini commits/pushes `LATEST.md` even on FAIL.
8. Maintainer replies `готово`.
9. Assistant reads fresh `LATEST.md`; FAIL -> fix the exact cause, PASS -> fold durable evidence into `docs/verification/README.md` and continue.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Windows remains **NOT TESTED**.
- Read command exit codes directly; avoid pipelines that mask failures.

## Remaining sequence after Codex

1. Antigravity cleanup/compatibility/freeze
2. Claude usage-only cleanup/compatibility/freeze
3. repository-wide provider invariants
4. cross-provider/product live acceptance
5. install/profile lifecycle
6. final release gate
